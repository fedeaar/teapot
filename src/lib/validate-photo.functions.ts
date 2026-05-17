// Server function: AI compliance inspection of a trench documentation photo.
// Returns null-able depth + visible-feature flags + an overall compliance
// score. Throws when no API key is set (caller wraps in try/catch).
//
// Uses raw fetch (not the AI SDK) because Gemini's OpenAI-compatible
// endpoint logs "responseFormat (json_schema) is not supported" for
// experimental_output and the SDK's default retries amplify 429s.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Canonical verdict values. The Gemini model is asked to emit one of these
// three strings directly; we store them in `images.verdict` and use them as
// the single source of truth across the app.
export const VERDICT_COMPLIANT = "compliant" as const;
export const VERDICT_NEEDS_REVIEW = "needs_review" as const;
export const VERDICT_NON_COMPLIANT = "non_compliant" as const;
export const VERDICTS = [VERDICT_COMPLIANT, VERDICT_NEEDS_REVIEW, VERDICT_NON_COMPLIANT] as const;
export type Verdict = (typeof VERDICTS)[number];

// Legacy alias kept while older modules still reference these names; new
// code should use VERDICT_* and Verdict.
export const PHOTO_CLASSES = VERDICTS;
export type PhotoClass = Verdict;

// Each classified photo represents a fixed length of trench coverage on the
// home/coverage views: count × METERS_PER_PHOTO.
export const METERS_PER_PHOTO = 10;

/** Normalize anything we might receive into a canonical Verdict (or null). */
export function verdictFromAny(v: string | null | undefined): Verdict | null {
  if (v === VERDICT_COMPLIANT || v === "green") return VERDICT_COMPLIANT;
  if (v === VERDICT_NEEDS_REVIEW || v === "yellow") return VERDICT_NEEDS_REVIEW;
  if (v === VERDICT_NON_COMPLIANT || v === "red") return VERDICT_NON_COMPLIANT;
  return null;
}

/**
 * Back-compat: pass either a traffic-light class ("green"/"yellow"/"red")
 * OR a canonical verdict and get the canonical verdict back.
 */
export function verdictFromClass(cls: string): Verdict {
  return verdictFromAny(cls) ?? VERDICT_NON_COMPLIANT;
}

/** Back-compat lookup that returns the traffic-light colour key. */
export function classFromVerdict(v: string | null | undefined): "green" | "yellow" | "red" | null {
  const normalized = verdictFromAny(v);
  if (normalized === VERDICT_COMPLIANT) return "green";
  if (normalized === VERDICT_NEEDS_REVIEW) return "yellow";
  if (normalized === VERDICT_NON_COMPLIANT) return "red";
  return null;
}

const ResultSchema = z.object({
  // Canonical verdict emitted directly by the model — same strings we store
  // in the DB ("compliant" / "needs_review" / "non_compliant").
  classification: z.enum(VERDICTS),
  score: z.number().min(0).max(100),
  // Relevance gate (merged from the old flagPhotoRelevance call)
  is_trench_photo: z.boolean(),
  subject: z.string(),
  rejection_code: z.string().nullable(),
  // System-level review criteria 1–4 (criteria 5 "duplicate detection" and
  // 6 "GPS consistency" are computed outside this Gemini call — sha256
  // matching and the geo-matcher handle those).
  trench_visible: z.boolean().default(false),
  cables_visible: z.boolean().default(false),
  warning_tape_visible: z.boolean().default(false),
  bedding_visible: z.boolean(),
  side_view_visible: z.boolean().default(false),
  ruler_visible: z.boolean(),
  // Detail compliance analysis
  depth_cm: z.number().nullable(),
  depth_pass: z.boolean(),
  visible_length_m: z.number().nullable(),
  duct_bundle_visible: z.boolean(),
  pipe_ends_visible: z.boolean(),
  unobstructed: z.boolean(),
  issues: z.array(z.string()),
  recommendation: z.string(),
});

const MIN_DEPTH_CM = 60;
// Kept for legacy callers that still read `compliant`. A photo is compliant
// only when the model classifies it green. Score is no longer the gate.
export const COMPLIANCE_THRESHOLD = 60;

const PROMPT = `You are a fiber-optic trench documentation auditor for an Austrian construction site.

Inspect the photo and emit EXACTLY ONE of three classification strings: "compliant", "needs_review", or "non_compliant". DEFAULT to "needs_review" — it should be the answer for the vast majority of real-world site photos. Only escape from "needs_review" when the evidence is unambiguous in one direction or the other. When in doubt, ALWAYS return "needs_review".

THE THREE CLASSIFICATIONS (output as the canonical "classification" field):

"non_compliant" — Use ONLY when at least one of these is true:
  - The photo is not of a trench / construction site at all (selfies, paperwork, food, paved surfaces with no excavation, unrelated scenes, blurry / black frames).
  - The photo does NOT show the open trench / excavation / work zone in frame (even if the surrounding area is a construction site).
  - The photo shows a trench but NO cables, ducts, or pipes are visible in it.
The trench itself has to be visible in the frame; don't upgrade to "needs_review" purely because a parked excavator, a worksite barrier, or a roll of duct is nearby. "non_compliant" means the photo is unusable as fiber-build evidence.

"needs_review" — DEFAULT for any photo that IS a real worksite shot of an open trench with cables/ducts visible but isn't a perfect documentation shot. This will cover nearly every real progress photo. Pick it when:
  - The trench AND cables/ducts are visible, but ANY of the documentation aids (side view, depth ruler, etc.) are missing, ambiguous, or out of frame.
  - You are between "compliant" and "non_compliant" and not sure which side to land on.

"compliant" — Use ONLY when ALL of these are clearly true in the SAME frame:
  - The trench is clearly visible from a side / oblique angle that shows the wall profile.
  - Cables / ducts / pipes are clearly visible inside the trench.
  - A depth reference (folding rule, tape measure, labeled stick) is leaning against the trench wall AND a depth can plausibly be read from it.
"compliant" is strict — if even one of those three items is partially visible, ambiguous, occluded, or only inferred from context, the answer is "needs_review".

IMPORTANT — what the classification does NOT depend on:
  - Warning tape visibility. Note tape presence/absence in warning_tape_visible and the per-criterion arguments, but do NOT let it move the classification.
  - Sand bedding visibility. Same — record it in bedding_visible but it does NOT decide the class.
  - Worker safety (unshored walls, no PPE, etc.). Note these in issues and recommendation if observed, but do NOT downgrade the class for them. Compliance with this AI gate is about documentation, not jobsite safety.

Criteria 5 (duplicate / reused photo across lots) and 6 (GPS consistent with declared project site) are handled OUTSIDE this call by the system (sha256 hashing + geo-matching). Do NOT factor them into the classification.

RELEVANCE GATE (set is_trench_photo first):
- is_trench_photo: true unless the photo is fundamentally not a worksite/trench scene. A poorly composed or partial trench shot is still a trench photo.
- subject: short description of what is actually in the image.
- rejection_code: one of "NOT_A_TRENCH" | "INDOOR" | "PORTRAIT" | "PAVED_SURFACE" | "DOCUMENT" | "TOO_DARK" | "UNRELATED" | null. Non-null only when classification is "non_compliant" for a relevance failure.

If is_trench_photo is FALSE, set classification="non_compliant", every other boolean=false, depth_cm=null, visible_length_m=null, score in [0, 25], issues=["NOT_A_TRENCH"], recommendation="Photo is not trench documentation; reshoot at the work site." and stop reasoning. Otherwise continue.

PER-CRITERION OBSERVATIONS (these populate the UI's argument list; they do NOT all feed the classification — see above):
- trench_visible: true if the open trench / excavation walls are visible.
- cables_visible: true if cables, ducts, pipes or duct bundles are visible inside the trench (even one).
- warning_tape_visible: true if a colored warning tape band is in frame, even just a strip. (Recorded but doesn't affect class.)
- bedding_visible: true if sand or fine bedding is visible around the ducts. (Recorded but doesn't affect class.)
- side_view_visible: true if the photo gives a side / oblique angle that reveals trench walls + profile.
- ruler_visible: true if a folding rule / tape / labeled stick is at least partially in frame against the wall.
- depth_cm: if a measurement reference is readable, estimate trench depth in cm. Otherwise null.
- depth_pass: true if depth_cm != null AND depth_cm >= ${MIN_DEPTH_CM}.
- duct_bundle_visible: pipes / ducts / duct bundle visible.
- pipe_ends_visible: pipe ends, sleeves, or connections visible.
- unobstructed: critical content not fully blocked by people, vehicles, or deep shadows.
- visible_length_m: rough estimate of visible trench length in meters, rounded to one decimal, or null.

CLASSIFICATION GATE (apply in this order):
1. If is_trench_photo == false OR !trench_visible OR !cables_visible → classification = "non_compliant".
2. Else if (side_view_visible AND (ruler_visible OR depth_pass)) → classification = "compliant".
3. Otherwise → classification = "needs_review".

Tie-break: any time you're hesitating between "compliant" and "needs_review", choose "needs_review". Any time you're hesitating between "needs_review" and "non_compliant", choose "needs_review". The bias is strongly toward "needs_review".

COMPLIANCE SCORE (0–100, integer; a quality score WITHIN the chosen class):
- non_compliant: score in [0, 30]. Use 0–10 for non-trench photos; 15–30 for trench-but-no-cables shots.
- needs_review: score in [35, 75]. Start at 55. Add 5 for each of side_view_visible / ruler_visible / depth_pass / warning_tape_visible / bedding_visible that IS present. Cap at 75.
- compliant: score in [80, 100]. Start at 85. Add up to 15 across visible_length_m readability, unobstructed, depth_pass with a healthy depth (>= ${MIN_DEPTH_CM} cm), and duct_bundle/pipe_ends clarity. Cap at 100.

The classification is the primary signal. The score is a secondary quality marker — do not let the score push you across class boundaries.

issues: short codes for what's missing or wrong (e.g. "WARNING_TAPE_MISSING", "BEDDING_MISSING", "SIDE_VIEW_MISSING", "DEPTH_TOO_SHALLOW", "DEPTH_UNREADABLE", "NO_CABLES_VISIBLE", "NOT_A_TRENCH", "TRENCH_UNSHORED"). Include safety codes here if observed, but again — they do NOT change the classification.
recommendation: ONE short, actionable sentence aimed at the NEXT photo.

Respond with ONLY a JSON object, no markdown fences, no commentary:
{"classification":"compliant"|"needs_review"|"non_compliant","score":number,"is_trench_photo":boolean,"subject":"string","rejection_code":"NOT_A_TRENCH"|"INDOOR"|"PORTRAIT"|"PAVED_SURFACE"|"DOCUMENT"|"TOO_DARK"|"UNRELATED"|null,"trench_visible":boolean,"cables_visible":boolean,"warning_tape_visible":boolean,"bedding_visible":boolean,"side_view_visible":boolean,"ruler_visible":boolean,"depth_cm":number|null,"depth_pass":boolean,"visible_length_m":number|null,"duct_bundle_visible":boolean,"pipe_ends_visible":boolean,"unobstructed":boolean,"issues":[string],"recommendation":"string"}`;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in response");
  return JSON.parse(body.slice(start, end + 1));
}

export const validatePhoto = createServerFn({ method: "POST" })
  .inputValidator((input: { imageUrl: string }) =>
    z.object({ imageUrl: z.string() }).parse(input),
  )
  .handler(async ({ data }) => {
    const geminiKey = process.env.GEMINI_API_KEY;
    const key = geminiKey;
    if (!key) throw new Error("GEMINI_API_KEY missing");

    const endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    const model = geminiKey ? "gemini-2.5-flash" : "google/gemini-2.5-flash";

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
      throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
    }

    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const parsed = ResultSchema.parse(extractJson(content));
    // Three-class classification is the source of truth. Legacy callers
    // still read `compliant` — it now mirrors classification == "compliant".
    const compliant = parsed.classification === VERDICT_COMPLIANT;
    return {
      ...parsed,
      compliant,
      min_depth_cm: MIN_DEPTH_CM,
      compliance_threshold: COMPLIANCE_THRESHOLD,
    };
  });
