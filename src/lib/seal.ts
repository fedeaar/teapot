export async function sealPhoto(
  imageBytes: ArrayBuffer,
  lat: number,
  lng: number,
  capturedAt: string,
): Promise<{ sha256: string; sealId: string }> {
  const meta = new TextEncoder().encode(`|${lat}|${lng}|${capturedAt}`);
  const combined = new Uint8Array(imageBytes.byteLength + meta.byteLength);
  combined.set(new Uint8Array(imageBytes), 0);
  combined.set(meta, imageBytes.byteLength);
  const hash = await crypto.subtle.digest("SHA-256", combined);
  const sha256 = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const sealId = `SP-${new Date(capturedAt).getFullYear()}-${sha256.slice(0, 10).toUpperCase()}`;
  return { sha256, sealId };
}
