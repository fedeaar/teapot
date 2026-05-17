// Server function: lightweight image classifier (currently used by an old
// per-photo result flow). Mirrors the raw-fetch pattern used by the import
// pipeline's flag/validate/ocr/ai-detect functions to avoid the AI SDK's
// unsupported responseFormat path on Gemini's OpenAI-compat endpoint.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ClassificationSchema = z.object({
  valid: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type ClassificationResult = z.infer<typeof ClassificationSchema>;

export const RULER_CLASSIFICATION_PROMPT = `You are a construction site photo compliance inspector for Austrian fiber-optic trench documentation.

Your task: determine whether a measuring device (ruler, folding rule, measuring rod, leveling staff, or tape measure) is clearly visible in the photo.

A photo is VALID/COMPLIANT only if:
- A measuring device with readable numeric markings (centimeter or meter scale) is clearly visible in the image.
- The measuring device must be placed inside or against the trench wall to indicate depth.
- The markings on the measuring device must be at least partially legible (you can read some numbers).

A photo is INVALID/NON-COMPLIANT if:
- No measuring device is present anywhere in the image.
- A measuring device is present but its markings are completely unreadable (too blurry, too far, fully obscured).
- Only informal references are used (e.g. a shovel handle, a person's arm) instead of a proper measuring instrument.

Set valid = true ONLY if a proper measuring device with readable markings is visible. Otherwise set valid = false.`;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in response");
  return JSON.parse(body.slice(start, end + 1));
}

export const classifyImage = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { imageUrl?: string; imageBase64?: string; prompt?: string }) =>
      z
        .object({
          imageUrl: z.string().optional(),
          imageBase64: z.string().optional(),
          prompt: z.string().min(1).optional(),
        })
        .refine((d) => d.imageUrl || d.imageBase64, {
          message: "Provide either imageUrl or imageBase64",
        })
        .parse(input),
  )
  .handler(async ({ data }): Promise<ClassificationResult> => {
    const geminiKey = process.env.GEMINI_API_KEY;
    const key = geminiKey;
    if (!key) throw new Error("GEMINI_API_KEY missing");

    const endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    const model = geminiKey ? "gemini-2.5-flash" : "google/gemini-2.5-flash";

    const imageUrl = data.imageUrl ?? data.imageBase64!;
    const prompt = `${data.prompt ?? RULER_CLASSIFICATION_PROMPT}\n\nRespond with ONLY a JSON object, no markdown fences:\n{"valid":boolean,"confidence":number,"reason":"string"}`;

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
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
    }

    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    return ClassificationSchema.parse(extractJson(content));
  });
