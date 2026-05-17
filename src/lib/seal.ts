// SHA-256 of the raw image bytes. EXIF GPS is part of the JPEG, so two
// uploads of "the same photo with different locations" already produce
// different bytes — no metadata salt needed.
export async function hashImageBytes(imageBytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", imageBytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sealPhoto(
  imageBytes: ArrayBuffer,
  _lat: number,
  _lng: number,
  capturedAt: string,
): Promise<{ sha256: string; sealId: string }> {
  const sha256 = await hashImageBytes(imageBytes);
  const sealId = `SP-${new Date(capturedAt).getFullYear()}-${sha256.slice(0, 10).toUpperCase()}`;
  return { sha256, sealId };
}

// Derive the storage filename from the sha256 hash, preserving the original
// extension (defaults to "jpg"). The returned name matches what is written to
// `images.filename` so the storage object key and DB row stay aligned.
export function hashedFilename(sha256: string, originalName?: string | null): string {
  const ext = extractExtension(originalName) ?? "jpg";
  return `${sha256}.${ext}`;
}

function extractExtension(name?: string | null): string | null {
  if (!name) return null;
  const m = name.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : null;
}
