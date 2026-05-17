// Client-side face detection + blur. Runs in the browser via face-api.js
// (tiny detector) so unblurred faces never leave the device — required for
// GDPR-safe storage of construction-site photos that may incidentally
// capture passers-by or workers.
//
// face-api is loaded dynamically because it depends on browser globals
// (document, HTMLImageElement, TF.js WebGL backend) and would crash during
// TanStack Start's SSR pass if imported at module load.
type FaceApiModule = typeof import("@vladmandic/face-api");

let faceApiPromise: Promise<FaceApiModule> | null = null;
let modelsLoading: Promise<void> | null = null;

async function loadFaceApi(): Promise<FaceApiModule> {
  if (!faceApiPromise) {
    faceApiPromise = import("@vladmandic/face-api").catch((err) => {
      faceApiPromise = null;
      throw err;
    });
  }
  return faceApiPromise;
}

async function ensureModelsLoaded(faceapi: FaceApiModule): Promise<void> {
  if (faceapi.nets.tinyFaceDetector.isLoaded) return;
  if (!modelsLoading) {
    modelsLoading = faceapi.nets.tinyFaceDetector.loadFromUri("/models").catch((err) => {
      modelsLoading = null;
      throw err;
    });
  }
  await modelsLoading;
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type FaceBlurResult = {
  // Replacement file with faces blurred; identical to input when no faces
  // were found (we avoid re-encoding to preserve EXIF for the EXIF path).
  file: File;
  faceCount: number;
  // True when face-api couldn't run or the browser cannot decode the image.
  // Callers should block upload because the storage bucket is public.
  detectorFailed: boolean;
  failureReason?: string;
};

function canvasToFile(canvas: HTMLCanvasElement, name: string, mimeType: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("Canvas encode failed"));
        resolve(new File([blob], name, { type: mimeType, lastModified: Date.now() }));
      },
      mimeType,
      0.92,
    );
  });
}

// Re-encoding strips EXIF. HEIC isn't decodable by <img> on most browsers
// anyway, so we let it through unchanged and rely on the server-side OCR
// fallback. JPEG/PNG/WebP get re-encoded as JPEG after blurring.
function outputMime(file: File): string {
  if (file.type === "image/png") return "image/png";
  if (file.type === "image/webp") return "image/webp";
  return "image/jpeg";
}

export async function blurFacesInFile(file: File): Promise<FaceBlurResult> {
  if (typeof document === "undefined") {
    return { file, faceCount: 0, detectorFailed: false };
  }
  if (!file.type.startsWith("image/")) {
    return { file, faceCount: 0, detectorFailed: false };
  }
  if (file.type === "image/heic" || file.type === "image/heif") {
    return {
      file,
      faceCount: 0,
      detectorFailed: true,
      failureReason: "HEIC/HEIF cannot be decoded for local face redaction.",
    };
  }

  let faceapi: FaceApiModule;
  try {
    faceapi = await loadFaceApi();
    await ensureModelsLoaded(faceapi);
  } catch (err) {
    console.warn("[face-blur] model load failed:", err);
    return {
      file,
      faceCount: 0,
      detectorFailed: true,
      failureReason: "Face detector unavailable.",
    };
  }

  let image: HTMLImageElement;
  try {
    image = await loadImageFromFile(file);
  } catch (err) {
    console.warn("[face-blur] image decode failed:", err);
    return {
      file,
      faceCount: 0,
      detectorFailed: true,
      failureReason: "Image could not be decoded for face redaction.",
    };
  }

  // inputSize must be a multiple of 32. 416 is a good speed/accuracy trade-off
  // for site photos which may have small/distant faces.
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 });
  let detections: Awaited<ReturnType<typeof faceapi.detectAllFaces>>;
  try {
    detections = await faceapi.detectAllFaces(image, options);
  } catch (err) {
    console.warn("[face-blur] detection failed:", err);
    return { file, faceCount: 0, detectorFailed: true, failureReason: "Face detection failed." };
  }

  if (detections.length === 0) {
    return { file, faceCount: 0, detectorFailed: false };
  }

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      file,
      faceCount: 0,
      detectorFailed: true,
      failureReason: "Canvas redaction unavailable.",
    };
  }
  ctx.drawImage(image, 0, 0);

  // Draw a heavily blurred + slightly enlarged box over each detected face.
  // Padding catches hairlines and ears that the detector clips.
  for (const det of detections) {
    const box = det.box;
    const pad = Math.max(box.width, box.height) * 0.25;
    const x = Math.max(0, Math.floor(box.x - pad));
    const y = Math.max(0, Math.floor(box.y - pad));
    const w = Math.min(canvas.width - x, Math.ceil(box.width + pad * 2));
    const h = Math.min(canvas.height - y, Math.ceil(box.height + pad * 2));
    if (w <= 0 || h <= 0) continue;

    const region = ctx.getImageData(x, y, w, h);
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const offCtx = off.getContext("2d");
    if (!offCtx) continue;
    offCtx.putImageData(region, 0, 0);

    ctx.save();
    ctx.filter = `blur(${Math.max(12, Math.round(Math.min(w, h) / 6))}px)`;
    ctx.drawImage(off, x, y);
    ctx.restore();
  }

  const mimeType = outputMime(file);
  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
  const blurred = await canvasToFile(canvas, `${baseName}.${ext}`, mimeType);

  return { file: blurred, faceCount: detections.length, detectorFailed: false };
}
