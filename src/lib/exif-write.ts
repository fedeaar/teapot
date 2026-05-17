// Inject GPS + capture timestamp EXIF into a canvas-encoded JPEG.
// canvas.toBlob() emits JPEGs with no EXIF segment, so the analyst re-import
// flow (which prefers EXIF GPS over OCR) has nothing to read. This adds an
// APP1/EXIF segment to the byte stream after JPEG encoding.
import piexif from "piexifjs";

function toDMSRational(deg: number): [number, number][] {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const sNum = (mFloat - m) * 60;
  // Seconds carry the precision — 1/10000s ~= 0.0003" ~= 1cm at the equator.
  return [
    [d, 1],
    [m, 1],
    [Math.round(sNum * 10000), 10000],
  ];
}

function bytesToBinaryString(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let out = "";
  // Chunk to avoid arg-length limits on String.fromCharCode for big files.
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    out += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  return out;
}

function binaryStringToBytes(bin: string): ArrayBuffer {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out.buffer;
}

export type ExifWriteInput = {
  lat: number;
  lng: number;
  // GPS accuracy in metres, from navigator.geolocation. Optional.
  accuracyM?: number | null;
  // ISO 8601 capture time. Written as both DateTimeOriginal and GPSDateStamp/GPSTimeStamp.
  capturedAt: string;
};

export function injectGpsExif(jpegBytes: ArrayBuffer, input: ExifWriteInput): ArrayBuffer {
  const date = new Date(input.capturedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const exifDateTime = `${date.getUTCFullYear()}:${pad(date.getUTCMonth() + 1)}:${pad(
    date.getUTCDate(),
  )} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  const gpsDateStamp = `${date.getUTCFullYear()}:${pad(date.getUTCMonth() + 1)}:${pad(date.getUTCDate())}`;

  const gps: Record<number, unknown> = {
    [piexif.GPSIFD.GPSVersionID]: [2, 3, 0, 0],
    [piexif.GPSIFD.GPSLatitudeRef]: input.lat >= 0 ? "N" : "S",
    [piexif.GPSIFD.GPSLatitude]: toDMSRational(input.lat),
    [piexif.GPSIFD.GPSLongitudeRef]: input.lng >= 0 ? "E" : "W",
    [piexif.GPSIFD.GPSLongitude]: toDMSRational(input.lng),
    [piexif.GPSIFD.GPSDateStamp]: gpsDateStamp,
    [piexif.GPSIFD.GPSTimeStamp]: [
      [date.getUTCHours(), 1],
      [date.getUTCMinutes(), 1],
      [date.getUTCSeconds(), 1],
    ],
  };
  if (input.accuracyM != null && Number.isFinite(input.accuracyM)) {
    // GPSHPositioningError is metres as a single rational.
    gps[piexif.GPSIFD.GPSHPositioningError] = [Math.round(input.accuracyM * 100), 100];
  }

  const exifObj = {
    "0th": {
      [piexif.ImageIFD.DateTime]: exifDateTime,
    },
    Exif: {
      [piexif.ExifIFD.DateTimeOriginal]: exifDateTime,
      [piexif.ExifIFD.DateTimeDigitized]: exifDateTime,
    },
    GPS: gps,
  };

  const exifSegment = piexif.dump(exifObj);
  const tagged = piexif.insert(exifSegment, bytesToBinaryString(jpegBytes));
  return binaryStringToBytes(tagged);
}
