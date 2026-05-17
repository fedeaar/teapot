// Server function: AI relevance gate for the photo importer. Decides whether
// a photo is plausibly a trench documentation photo before we spend a
// compliance scoring call on it. Fails open so transient gateway issues
// don't drop valid photos.
//
// Uses raw fetch (not the AI SDK) because Gemini's OpenAI-compatible
// endpoint logs "responseFormat (json_schema) is not supported" for
// experimental_output and the SDK's default retries amplify 429s.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const FlagSchema = z.object({
  is_trench_photo: z.boolean(),
  subject: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  rejection_code: z.string().nullable(),
});

export type PhotoFlag = z.infer<typeof FlagSchema>;

const FAIL_OPEN: PhotoFlag = {
  is_trench_photo: true,
  subject: "unknown",
  confidence: 0,
  reason: "AI flagger unavailable; assumed relevant.",
  rejection_code: null,
};

const PROMPT = `You are a quality gate for an Austrian fiber-optic trench documentation system.

Decide if this photo could plausibly be inspected as a trench documentation photo.

ACCEPT photos showing: an open ground excavation, soil walls of a trench, ducts/pipes/cable bundles laid in soil, sand/gravel bedding, manholes/handholes (Schacht), or measurement tools (folding rule, tape) at a worksite. Even partial or poorly lit trench photos must be ACCEPTED.

REJECT: portraits/selfies, indoor scenes, paperwork/screenshots, finished paved surfaces with no excavation, vehicles only, unrelated landscapes, food, animals, blurry/black frames.

Respond with ONLY a JSON object, no markdown fences, no commentary:
{"is_trench_photo":boolean,"subject":"string","confidence":number,"reason":"string","rejection_code":"NOT_A_TRENCH"|"INDOOR"|"PORTRAIT"|"PAVED_SURFACE"|"DOCUMENT"|"TOO_DARK"|"UNRELATED"|null}`;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in response");
  return JSON.parse(body.slice(start, end + 1));
}

export const flagPhotoRelevance = createServerFn({ method: "POST" })
  .inputValidator((input: { imageUrl: string }) =>
    z.object({ imageUrl: z.string() }).parse(input),
  )
  .handler(async ({ data }): Promise<PhotoFlag> => {
    const geminiKey = process.env.GEMINI_API_KEY;
    const key = geminiKey;
    if (!key) {
      console.warn("[flagPhotoRelevance] GEMINI_API_KEY missing");
      return FAIL_OPEN;
    }

    const endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    const model = geminiKey ? "gemini-2.5-flash" : "google/gemini-2.5-flash";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: PROMPT },
                { type: "image_url", image_url: { url: data.imageUrl } },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(`[flagPhotoRelevance] ${res.status}:`, body.slice(0, 200));
        return FAIL_OPEN;
      }

      const payload = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content ?? "";
      return FlagSchema.parse(extractJson(content));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[flagPhotoRelevance] failed:", message);
      return FAIL_OPEN;
    }
  });
