// Read GPS + capture timestamp out of an image's EXIF metadata.
// Returns null when the photo has no GPS — caller must decide what to do.
import exifr from "exifr";

export type ExifResult = {
  lat: number;
  lng: number;
  capturedAt: string | null; // ISO 8601; null if no DateTimeOriginal
};

export async function readExif(file: File): Promise<ExifResult | null> {
  try {
    const parsed = await exifr.parse(file, {
      gps: true,
      pick: ["DateTimeOriginal", "CreateDate", "ModifyDate"],
    });
    if (!parsed) return null;
    const lat = typeof parsed.latitude === "number" ? parsed.latitude : null;
    const lng = typeof parsed.longitude === "number" ? parsed.longitude : null;
    if (lat == null || lng == null) return null;

    const dt: Date | undefined = parsed.DateTimeOriginal ?? parsed.CreateDate ?? parsed.ModifyDate;
    const capturedAt = dt instanceof Date && !Number.isNaN(dt.getTime()) ? dt.toISOString() : null;

    return { lat, lng, capturedAt };
  } catch {
    return null;
  }
}
