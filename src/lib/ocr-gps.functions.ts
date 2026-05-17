// Server function: read the full stamped overlay off a construction-site
// photo (GPS coordinates, address, date/time). Used as a fallback when the
// photo's EXIF metadata is missing GPS tags. Handles overlays in German and
// Russian, and both decimal and DMS coordinate formats.
//
// Uses a single raw fetch (not the AI SDK) so a 429 doesn't trigger the
// SDK's default 2-retry backoff, which amplifies every rate-limit by 3×.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const OverlayOcrSchema = z.object({
  found: z.boolean(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  address: z.string().nullable(),
  capturedAt: z.string().nullable(),
  raw: z.string(),
});

export type GpsOcrResult = z.infer<typeof OverlayOcrSchema>;

const EMPTY_RESULT: GpsOcrResult = {
  found: false,
  lat: null,
  lng: null,
  address: null,
  capturedAt: null,
  raw: "",
};

const OVERLAY_OCR_PROMPT = `You are reading a stamped overlay on a construction-site photo from Austria.

The overlay (usually top-right or top-left corner) typically contains:
- a date/time (e.g. "04.09.2024 18:57:02" German, or "3 сент. 2024 г. 13:43:55" Russian)
- GPS coordinates in EITHER:
  * decimal form: "46.56178781N 14.28857304E"
  * DMS form: "46°33'29,23391\"N 14°17'23,58729\"E" (commas are decimal separators)
  Austrian latitudes 46–49, longitudes 9–17.
- a street address spanning multiple lines (e.g. "7 Schulweg / Maria Rain, Klagenfurt-Land 9161 / Австрия")

Extract:
- lat: decimal latitude as a number. If DMS, convert: deg + min/60 + sec/3600. Treat ',' as '.'.
- lng: decimal longitude as a number (same conversion).
- address: the full address joined with commas (e.g. "7 Schulweg, Maria Rain, Klagenfurt-Land 9161, Austria"). Translate "Австрия"→"Austria".
- capturedAt: ISO 8601 timestamp (assume local time, no Z suffix, e.g. "2024-09-04T18:57:02"). Russian months: янв=01 фев=02 мар=03 апр=04 май=05 июн=06 июл=07 авг=08 сент=09 окт=10 ноя=11 дек=12.
- found: true if you read ANY of the above
- raw: the exact overlay text concatenated with " | "

Ignore handwriting, signs in the trench, the Google map inset, or anything not in the stamped overlay.

Respond with ONLY a JSON object, no markdown fences, no commentary:
{"found":boolean,"lat":number|null,"lng":number|null,"address":string|null,"capturedAt":string|null,"raw":"string"}`;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in response");
  return JSON.parse(body.slice(start, end + 1));
}

export const ocrGpsFromImage = createServerFn({ method: "POST" })
  .inputValidator((input: { imageUrl?: string; imageBase64?: string }) =>
    z
      .object({
        imageUrl: z.string().optional(),
        imageBase64: z.string().optional(),
      })
      .refine((d) => d.imageUrl || d.imageBase64, {
        message: "Provide either imageUrl or imageBase64",
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<GpsOcrResult> => {
    const geminiKey = process.env.GEMINI_API_KEY;
    const key = geminiKey;
    if (!key) {
      console.warn("[ocrGpsFromImage] GEMINI_API_KEY missing");
      return EMPTY_RESULT;
    }

    // Prefer Gemini's OpenAI-compatible endpoint when we have a direct key;
    const endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    const model = "gemini-2.5-flash";

    const imageUrl = data.imageUrl ?? data.imageBase64!;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: OVERLAY_OCR_PROMPT },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(`[ocrGpsFromImage] ${res.status}:`, body.slice(0, 200));
        return EMPTY_RESULT;
      }

      const payload = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content ?? "";
      const parsed = OverlayOcrSchema.parse(extractJson(content));
      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[ocrGpsFromImage] failed:", message);
      return EMPTY_RESULT;
    }
  });
