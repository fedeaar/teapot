// Server function: ask the detectaiimage.com API whether a photo is
// AI-generated. Returns a fail-open result on transient errors so we don't
// block uploads.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const AiDetectionSchema = z.object({
  is_ai_generated: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type AiDetectionResult = z.infer<typeof AiDetectionSchema>;

const FAIL_OPEN: AiDetectionResult = {
  is_ai_generated: false,
  confidence: 0,
  reason: "AI-image detector unavailable; assumed authentic.",
};

const ENDPOINT = "https://api.detectaiimage.com/detect";

export const detectAiGenerated = createServerFn({ method: "POST" })
  .inputValidator((input: { imageUrl: string }) =>
    z.object({ imageUrl: z.string() }).parse(input),
  )
  .handler(async ({ data }): Promise<AiDetectionResult> => {
    const key = process.env.DETECT_AI_IMAGE_API_KEY;
    if (!key) {
      console.warn("[detectAiGenerated] DETECT_AI_IMAGE_API_KEY missing");
      return FAIL_OPEN;
    }

    try {
      // Fetch the image bytes from the public URL and forward them as
      // multipart form-data — the API takes a file, not a URL.
      const imgRes = await fetch(data.imageUrl);
      if (!imgRes.ok) {
        console.warn(`[detectAiGenerated] image fetch ${imgRes.status}`);
        return FAIL_OPEN;
      }
      const blob = await imgRes.blob();
      const form = new FormData();
      form.append("file", blob, "photo.jpg");

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(`[detectAiGenerated] ${res.status}:`, body.slice(0, 200));
        return FAIL_OPEN;
      }

      const payload = (await res.json()) as { is_ai?: boolean; confidence?: number };
      if (typeof payload.is_ai !== "boolean" || typeof payload.confidence !== "number") {
        console.warn("[detectAiGenerated] unexpected payload:", payload);
        return FAIL_OPEN;
      }
      return AiDetectionSchema.parse({
        is_ai_generated: payload.is_ai,
        confidence: payload.confidence,
        reason: payload.is_ai
          ? `detectaiimage.com confidence ${payload.confidence.toFixed(2)}`
          : "detectaiimage.com classified as authentic",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[detectAiGenerated] failed:", message);
      return FAIL_OPEN;
    }
  });
