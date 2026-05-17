// Bulk-import photos with EXIF GPS, snap each to the nearest 5 m waypoint,
// upload to the `photos` bucket, and show a coverage report after.
//
// Used by the analyst project flow and by the demo dashboard per-FCP flow.
// `projectId` is null in the demo flow (images.project_id is nullable).
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ArrowLeft,
  Loader2,
  Upload,
  Image as ImageIcon,
  AlertTriangle,
  CheckCircle2,
  Ban,
  MapPin,
  ScanText,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { loadSiteData, type SiteData } from "@/lib/site-data";
import { readExif } from "@/lib/exif";
import { matchPhotoToWaypoint, isOffSite, type PhotoMatch } from "@/lib/match-photo";
import {
  verdictFromAny,
  VERDICT_COMPLIANT,
  VERDICT_NEEDS_REVIEW,
  VERDICT_NON_COMPLIANT,
  type Verdict,
} from "@/lib/validate-photo.functions";
import { siteDataToProjectData } from "@/lib/site-adapter";
import { sealPhoto } from "@/lib/seal";
import { CoverageReport } from "@/components/site/CoverageReport";
import { ocrGpsFromImage } from "@/lib/ocr-gps.functions";
import { geocodeAddress } from "@/lib/geocode.functions";
import { validatePhoto } from "@/lib/validate-photo.functions";
import { type PhotoFlag } from "@/lib/flag-photo.functions";
import { detectAiGenerated, type AiDetectionResult } from "@/lib/detect-ai-image.functions";
import { blurFacesInFile } from "@/lib/face-blur";

export type PhotoAnalysis = {
  depth_cm: number | null;
  depth_pass: boolean;
  min_depth_cm: number;
  visible_length_m: number | null;
  ruler_visible: boolean;
  bedding_visible: boolean;
  duct_bundle_visible: boolean;
  pipe_ends_visible: boolean;
  unobstructed: boolean;
  compliant: boolean;
  score: number;
  issues: string[];
  recommendation: string;
};

type GpsSource = "exif" | "ocr" | "geocode";

type ItemState =
  | { kind: "scanning"; phase: "exif" | "ocr" | "geocode" | "blur" }
  | { kind: "no_gps" }
  | {
      kind: "ready";
      match: PhotoMatch;
      sha256: string;
      sealId: string;
      capturedAt: string;
      lat: number;
      lng: number;
      gpsSource: GpsSource;
      faceCount: number;
    }
  | { kind: "uploading"; gpsSource: GpsSource; faceCount: number }
  | { kind: "duplicate" }
  | {
      kind: "uploaded";
      photoId: string;
      match: PhotoMatch;
      gpsSource: GpsSource;
      analysis: PhotoAnalysis | null;
      faceCount: number;
      aiGenerated: AiDetectionResult | null;
    }
  | { kind: "error"; message: string };

type Item = {
  key: string;
  file: File;
  objectUrl: string;
  state: ItemState;
};

// Each upload fires up to 3 Gemini calls (flag + ai-detect + validate). The
// free Gemini tier caps gemini-2.5-flash at 10 RPM, so 4 parallel uploads
// (12 calls + bursting) hits the limit instantly. Keep this conservative.
const UPLOAD_CONCURRENCY = 2;

function makeKey(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}::${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function imageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(file);
    const dim = { width: bmp.width, height: bmp.height };
    bmp.close?.();
    return dim;
  } catch {
    return null;
  }
}

function fileExtension(name: string): string {
  const m = name.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : "jpg";
}

function fallbackCapturedAt(file: File, exifIso: string | null): string {
  if (exifIso) return exifIso;
  if (file.lastModified) return new Date(file.lastModified).toISOString();
  return new Date().toISOString();
}

// Supabase's StorageError / PostgrestError are plain objects with a `.message`
// property, not `Error` instances — `String(e)` on them produces the dreaded
// "[object Object]". Walk the common shapes so the UI shows something useful.
function errorToMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const r = e as Record<string, unknown>;
    if (typeof r.message === "string") {
      const detail = typeof r.details === "string" ? `: ${r.details}` : "";
      return `${r.message}${detail}`;
    }
    if (typeof r.error === "string") return r.error;
    if (typeof r.statusCode === "number" || typeof r.status === "number") {
      const code = r.statusCode ?? r.status;
      return `HTTP ${code}`;
    }
    try {
      return JSON.stringify(e);
    } catch {
      return "Unknown error";
    }
  }
  return String(e);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

// Map AI analysis + match status onto the photos.status enum
// ("compliant" | "flagged" | "pending" | "irrelevant") used elsewhere in the app.
function deriveStatus(
  matchStatus: "pending" | "flagged",
  analysis: PhotoAnalysis | null,
  flag: PhotoFlag | null,
  ai: AiDetectionResult | null,
): "compliant" | "flagged" | "pending" | "irrelevant" {
  if (isIrrelevant(flag)) return "irrelevant";
  if (ai && ai.is_ai_generated && ai.confidence >= 0.5) return "flagged";
  if (matchStatus === "flagged") return "flagged";
  if (!analysis) return "pending";
  return analysis.compliant ? "compliant" : "flagged";
}

function isIrrelevant(flag: PhotoFlag | null): boolean {
  if (!flag) return false;
  return !flag.is_trench_photo && flag.confidence >= 0.5;
}

function isLikelyAiGenerated(ai: AiDetectionResult | null): boolean {
  if (!ai) return false;
  return ai.is_ai_generated && ai.confidence >= 0.5;
}

export type PhotoImporterProps = {
  // Persisted on `images.project_id`. null in the demo dashboard flow.
  projectId?: string | null;
  // Legacy alias kept for the old generated route still present in the tree.
  siteId?: string | null;
  // Where the back-arrow in the header navigates to. Ignored if `onBack` is provided.
  backHref?: string;
  // In-page back handler. Use when the importer is rendered inside a tabbed view
  // and the parent owns the "back" semantics (e.g. switching tabs instead of routing).
  onBack?: () => void;
  // Optional title override.
  title?: string;
  // Optional helper text under the title.
  subtitle?: string;
  // If set, the matcher still runs across all FCPs but rows where the
  // matched FCP differs from this id are flagged with `wrong_fcp`.
  expectedFcpId?: string | null;
  // Called after a successful batch upload completes.
  onImported?: () => void;
};

export function PhotoImporter({
  projectId = null,
  siteId = null,
  backHref,
  onBack,
  title = "Import photos",
  subtitle = "Backfill GPS-tagged photos. Each is snapped to the nearest 5 m waypoint.",
  expectedFcpId = null,
  onImported,
}: PhotoImporterProps) {
  const activeProjectId = projectId ?? siteId;
  const [site, setSite] = useState<SiteData | null>(null);
  const projectSite = useMemo(() => (site ? siteDataToProjectData(site) : null), [site]);
  // Maps geojson FCP/trench names → DB UUIDs. images.fcp_id / trench_id are
  // UUID FKs; the geojson uses string codes like "F169". When a projectId
  // (project) is set we look up the matching rows so we can populate the FK;
  // otherwise we store null and surface the name in issues for traceability.
  const [fcpUuids, setFcpUuids] = useState<Map<string, string>>(new Map());
  const [trenchUuids, setTrenchUuids] = useState<Map<string, string>>(new Map());
  const [items, setItems] = useState<Item[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [doneBatch, setDoneBatch] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ocrGps = useServerFn(ocrGpsFromImage);
  const geocode = useServerFn(geocodeAddress);
  const validate = useServerFn(validatePhoto);
  const aiDetect = useServerFn(detectAiGenerated);
  const navigate = useNavigate();

  // Build trench -> fcpId lookup so we can deep-link rows to the dashboard.
  const trenchToFcp = useMemo(() => {
    const m: Record<string, string> = {};
    if (!site) return m;
    for (const fcpId of Object.keys(site.trenchesByFcp)) {
      for (const t of site.trenchesByFcp[fcpId]) m[t.id] = fcpId;
    }
    return m;
  }, [site]);

  // v1 uses the bundled demo geometry. TODO: load this site's GIS from the
  // `site-gis` bucket using `siteId` once a site-aware loader exists.
  useEffect(() => {
    void loadSiteData().then(setSite);
  }, []);

  useEffect(() => {
    if (!activeProjectId) return;
    void (async () => {
      const { data: fcps } = await supabase
        .from("fcps")
        .select("id, fcp_name")
        .eq("project_id", activeProjectId);
      if (fcps) {
        const m = new Map<string, string>();
        for (const f of fcps) if (f.fcp_name) m.set(f.fcp_name, f.id);
        setFcpUuids(m);
      }
      const { data: trenches } = await supabase
        .from("trenches")
        .select("id, name")
        .eq("project_id", activeProjectId);
      if (trenches) {
        const m = new Map<string, string>();
        for (const t of trenches) if (t.name) m.set(t.name, t.id);
        setTrenchUuids(m);
      }
    })();
  }, [activeProjectId]);

  // Revoke object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const it of items) URL.revokeObjectURL(it.objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateItem(key: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function removeItem(key: string) {
    setItems((prev) => {
      const target = prev.find((it) => it.key === key);
      if (target) URL.revokeObjectURL(target.objectUrl);
      return prev.filter((it) => it.key !== key);
    });
  }

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      if (!site) return;
      const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (list.length === 0) return;

      const newItems: Item[] = list.map((file) => ({
        key: makeKey(file),
        file,
        objectUrl: URL.createObjectURL(file),
        state: { kind: "scanning", phase: "exif" } as ItemState,
      }));
      setItems((prev) => [...prev, ...newItems]);
      setDoneBatch(false);

      for (const it of newItems) {
        void (async () => {
          let lat: number | null = null;
          let lng: number | null = null;
          let exifCapturedAt: string | null = null;
          let overlayCapturedAt: string | null = null;
          let overlayRaw: string | null = null;
          let overlayAddress: string | null = null;
          let gpsSource: GpsSource = "exif";

          const exif = await readExif(it.file);
          if (exif) {
            lat = exif.lat;
            lng = exif.lng;
            exifCapturedAt = exif.capturedAt;
          } else {
            // Fallback step 1: OCR the stamped overlay (GPS + address + date).
            updateItem(it.key, { state: { kind: "scanning", phase: "ocr" } });
            let ocrAddress: string | null = null;
            try {
              const dataUrl = await fileToDataUrl(it.file);
              const ocr = await ocrGps({ data: { imageBase64: dataUrl } });
              if (ocr.found) {
                overlayCapturedAt = ocr.capturedAt;
                overlayRaw = ocr.raw || null;
                overlayAddress = ocr.address;
                if (ocr.lat != null && ocr.lng != null) {
                  lat = ocr.lat;
                  lng = ocr.lng;
                  gpsSource = "ocr";
                } else if (ocr.address) {
                  ocrAddress = ocr.address;
                }
              }
            } catch {
              // OCR failure is non-fatal — fall through to no_gps.
            }

            // Fallback step 2: geocode the address read from the overlay.
            if ((lat == null || lng == null) && ocrAddress) {
              updateItem(it.key, { state: { kind: "scanning", phase: "geocode" } });
              try {
                const g = await geocode({ data: { query: ocrAddress } });
                if (g.found && g.lat != null && g.lng != null) {
                  lat = g.lat;
                  lng = g.lng;
                  gpsSource = "geocode";
                }
              } catch {
                // Geocode failure is non-fatal — fall through to no_gps.
              }
            }
          }

          if (lat == null || lng == null) {
            updateItem(it.key, { state: { kind: "no_gps" } });
            return;
          }

          const match = matchPhotoToWaypoint({ lat, lng }, siteDataToProjectData(site));
          if (gpsSource === "ocr") {
            match.issues = [...match.issues, "gps_from_overlay"];
          } else if (gpsSource === "geocode") {
            match.issues = [...match.issues, "gps_from_address"];
          }
          if (overlayAddress) {
            match.issues = [...match.issues, `address:${overlayAddress}`];
          }
          if (overlayRaw && gpsSource !== "exif") {
            match.issues = [...match.issues, `overlay:${overlayRaw.slice(0, 200)}`];
          }
          // If the import was opened from a specific FCP and the photo lands in
          // a different one, flag it so the analyst notices.
          if (expectedFcpId && match.fcpId && match.fcpId !== expectedFcpId) {
            match.status = "flagged";
            match.issues = [...match.issues, `wrong_fcp:${match.fcpId}`];
          }
          const capturedAt = fallbackCapturedAt(it.file, exifCapturedAt ?? overlayCapturedAt);

          // GDPR step: blur any faces in the photo client-side. Must happen
          // AFTER EXIF/OCR (which need the original bytes) and BEFORE sealing
          // (so sha256 binds to the image we actually upload). We mutate the
          // Item's file/objectUrl so the preview reflects what gets stored.
          updateItem(it.key, { state: { kind: "scanning", phase: "blur" } });
          const blurResult = await blurFacesInFile(it.file);
          if (blurResult.detectorFailed) {
            updateItem(it.key, {
              state: {
                kind: "error",
                message:
                  blurResult.failureReason ??
                  "Face privacy check failed. Convert the image to JPEG/PNG/WebP or remove visible faces before upload.",
              },
            });
            return;
          }
          let workingFile = it.file;
          if (blurResult.file !== it.file) {
            URL.revokeObjectURL(it.objectUrl);
            const newUrl = URL.createObjectURL(blurResult.file);
            workingFile = blurResult.file;
            updateItem(it.key, { file: workingFile, objectUrl: newUrl });
          }
          if (blurResult.faceCount > 0) {
            match.issues = [...match.issues, `faces_blurred:${blurResult.faceCount}`];
          }
          const bytes = await workingFile.arrayBuffer();
          const { sha256, sealId } = await sealPhoto(bytes, lat, lng, capturedAt);
          updateItem(it.key, {
            state: {
              kind: "ready",
              match,
              sha256,
              sealId,
              capturedAt,
              lat,
              lng,
              gpsSource,
              faceCount: blurResult.faceCount,
            },
          });
        })();
      }
    },
    [site, expectedFcpId, ocrGps, geocode],
  );

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }

  const readyCount = items.filter((it) => it.state.kind === "ready").length;
  const noGpsCount = items.filter((it) => it.state.kind === "no_gps").length;
  const uploadedCount = items.filter((it) => it.state.kind === "uploaded").length;
  const duplicateCount = items.filter((it) => it.state.kind === "duplicate").length;
  const errorCount = items.filter((it) => it.state.kind === "error").length;

  async function uploadAll() {
    if (uploading || readyCount === 0) return;
    setUploading(true);

    const readyItems = items.filter(
      (it): it is Item & { state: Extract<ItemState, { kind: "ready" }> } =>
        it.state.kind === "ready",
    );
    const sha256s = readyItems.map((it) => it.state.sha256);
    const { data: existing } = await supabase.from("images").select("sha256").in("sha256", sha256s);
    const existingSet = new Set(
      (existing ?? []).map((r) => r.sha256).filter((s): s is string => !!s),
    );

    const toUpload = readyItems.filter((it) => !existingSet.has(it.state.sha256));
    for (const it of readyItems) {
      if (existingSet.has(it.state.sha256)) {
        updateItem(it.key, { state: { kind: "duplicate" } });
      }
    }

    setProgress({ done: 0, total: toUpload.length });

    let next = 0;
    let done = 0;
    async function worker() {
      while (true) {
        const i = next++;
        if (i >= toUpload.length) return;
        const it = toUpload[i];
        await uploadOne(it).catch(() => {
          /* uploadOne already wrote the error state */
        });
        done++;
        setProgress({ done, total: toUpload.length });
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, toUpload.length) }, () => worker()),
    );

    setUploading(false);
    setDoneBatch(true);
    onImported?.();
  }

  // Upload a no_gps item without coordinates / validation. Face-blur + seal
  // still run; the row is inserted with status="flagged" and issue "no_gps".
  async function uploadNoGps(it: Item) {
    if (it.state.kind !== "no_gps") return;
    updateItem(it.key, { state: { kind: "uploading", gpsSource: "exif", faceCount: 0 } });
    try {
      // Blur faces (GDPR) and update preview.
      const blurResult = await blurFacesInFile(it.file);
      if (blurResult.detectorFailed) {
        throw new Error(
          blurResult.failureReason ??
            "Face privacy check failed. Convert the image to JPEG/PNG/WebP or remove visible faces before upload.",
        );
      }
      let workingFile = it.file;
      if (blurResult.file !== it.file) {
        URL.revokeObjectURL(it.objectUrl);
        const newUrl = URL.createObjectURL(blurResult.file);
        workingFile = blurResult.file;
        updateItem(it.key, { file: workingFile, objectUrl: newUrl });
      }

      const capturedAt = fallbackCapturedAt(workingFile, null);
      const bytes = await workingFile.arrayBuffer();
      const { sha256, sealId } = await sealPhoto(bytes, 0, 0, capturedAt);

      const dims = await imageDimensions(workingFile);
      const ext = fileExtension(workingFile.name);
      const filename = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("photos")
        .upload(filename, workingFile, { contentType: workingFile.type || "image/jpeg" });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("photos").getPublicUrl(filename);

      const issues = ["no_gps"];
      if (blurResult.faceCount > 0) issues.push(`faces_blurred:${blurResult.faceCount}`);

      const { data: inserted, error: insErr } = await supabase
        .from("images")
        .insert({
          filename,
          image_url: pub.publicUrl,
          captured_at: capturedAt,
          project_id: activeProjectId,
          sha256,
          status: "flagged",
          issues,
          image_width: dims?.width ?? null,
          image_height: dims?.height ?? null,
          file_size_bytes: workingFile.size,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;

      const placeholderMatch: PhotoMatch = {
        fcpId: null,
        trenchId: null,
        clusterId: null,
        waypointIndex: null,
        waypointLat: null,
        waypointLng: null,
        distanceToWaypointM: null,
        status: "flagged",
        issues,
      };
      void sealId;
      updateItem(it.key, {
        state: {
          kind: "uploaded",
          photoId: inserted!.id,
          match: placeholderMatch,
          gpsSource: "exif",
          analysis: null,
          faceCount: blurResult.faceCount,
          aiGenerated: null,
        },
      });
    } catch (e: unknown) {
      updateItem(it.key, { state: { kind: "error", message: errorToMessage(e) } });
    }
  }

  async function uploadOne(it: Item & { state: Extract<ItemState, { kind: "ready" }> }) {
    const { file, state } = it;
    const { match, sha256, sealId, capturedAt, lat, lng, gpsSource, faceCount } = state;
    updateItem(it.key, { state: { kind: "uploading", gpsSource, faceCount } });

    try {
      const dims = await imageDimensions(file);
      const ext = fileExtension(file.name);
      const filename = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("photos")
        .upload(filename, file, { contentType: file.type || "image/jpeg" });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("photos").getPublicUrl(filename);

      // 1. Synthetic-image gate first. If the photo is AI-generated, skip
      //    compliance scoring entirely — saves one Gemini call.
      const aiResult = await aiDetect({ data: { imageUrl: pub.publicUrl } }).catch((e) => {
        console.warn("[import] detectAiGenerated failed", e);
        return null as AiDetectionResult | null;
      });
      const aiGenerated = isLikelyAiGenerated(aiResult);

      // 2. Combined relevance + compliance call. The validatePhoto prompt now
      //    also returns is_trench_photo / subject / rejection_code so a single
      //    Gemini call covers both gates. Skipped when AI-generated, or when
      //    the matcher already says the photo is off-site — scoring a photo
      //    that isn't on the construction site is meaningless.
      const offSite = isOffSite(match.issues);
      let analysis: PhotoAnalysis | null = null;
      let flagResult: PhotoFlag | null = null;
      if (!aiGenerated && !offSite) {
        try {
          const inspection = (await validate({ data: { imageUrl: pub.publicUrl } })) as
            PhotoAnalysis & { is_trench_photo: boolean; subject: string; rejection_code: string | null };
          flagResult = {
            is_trench_photo: inspection.is_trench_photo,
            subject: inspection.subject,
            rejection_code: inspection.rejection_code,
            confidence: 1,
            reason: inspection.recommendation,
          };
          analysis = inspection;
        } catch (e) {
          console.warn("[import] validatePhoto failed", e);
        }
      }
      const irrelevant = isIrrelevant(flagResult);
      // If the photo isn't a trench, drop the (meaningless) compliance fields
      // so deriveStatus / passed-checks logic doesn't credit it.
      if (irrelevant) analysis = null;

      // Resolve geojson names → DB UUIDs for the FK columns. Anything not
      // found becomes null on the row but is preserved in `issues`.
      const resolvedFcpId = match.fcpId ? (fcpUuids.get(match.fcpId) ?? null) : null;
      const resolvedTrenchId = match.trenchId ? (trenchUuids.get(match.trenchId) ?? null) : null;
      const lookupIssues: string[] = [];
      if (match.fcpId && !resolvedFcpId) lookupIssues.push(`unknown_fcp:${match.fcpId}`);
      if (match.trenchId && !resolvedTrenchId)
        lookupIssues.push(`unknown_trench:${match.trenchId}`);

      const finalStatus = deriveStatus(match.status, analysis, flagResult, aiResult);
      const flagIssues: string[] = [];
      if (irrelevant) {
        flagIssues.push("IRRELEVANT");
        if (flagResult?.rejection_code) flagIssues.push(flagResult.rejection_code);
        if (flagResult?.subject) flagIssues.push(`ai_subject:${flagResult.subject}`);
      }
      if (aiGenerated) {
        flagIssues.push("AI_GENERATED");
        if (aiResult) flagIssues.push(`ai_confidence:${aiResult.confidence.toFixed(2)}`);
      }
      // Snap the stored coordinate to the matched 5 m waypoint when one was
      // found. The raw GPS reading is preserved in `issues` so the review
      // page can show how far the photo moved during the snap.
      const snapLat = match.waypointLat;
      const snapLng = match.waypointLng;
      const snapped = snapLat != null && snapLng != null;
      const storedLat = snapped ? snapLat : lat;
      const storedLng = snapped ? snapLng : lng;
      const snapIssues: string[] = [];
      if (snapped) {
        snapIssues.push(`original_gps:${lat.toFixed(6)},${lng.toFixed(6)}`);
        if (match.distanceToWaypointM != null) {
          snapIssues.push(`snapped:${match.distanceToWaypointM.toFixed(1)}m`);
        }
      }

      const issues = [...match.issues, ...flagIssues, ...lookupIssues, ...snapIssues, ...(analysis?.issues ?? [])];
      const passed: string[] = [];
      if (analysis) {
        if (analysis.depth_pass) passed.push("DEPTH_OK");
        if (analysis.ruler_visible) passed.push("RULER_OK");
        if (analysis.bedding_visible) passed.push("BEDDING_OK");
        if (analysis.duct_bundle_visible) passed.push("DUCT_OK");
        if (analysis.pipe_ends_visible) passed.push("PIPE_ENDS_OK");
        if (analysis.unobstructed) passed.push("UNOBSTRUCTED_OK");
        if (analysis.visible_length_m != null) passed.push("LENGTH_OK");
      }

      const { data: inserted, error: insErr } = await supabase
        .from("images")
        .insert({
          filename,
          image_url: pub.publicUrl,
          latitude: storedLat,
          longitude: storedLng,
          captured_at: capturedAt,
          fcp_id: resolvedFcpId,
          trench_id: resolvedTrenchId,
          waypoint_index: match.waypointIndex,
          cluster_id: match.clusterId,
          project_id: activeProjectId,
          sha256,
          status: finalStatus,
          // verdict stores the canonical compliance string:
          //   compliant       (green: every required item visible)
          //   needs_review    (yellow: trench + cables, some items missing)
          //   non_compliant   (red: no trench / no cables, or AI-flagged)
          // Falls back to a score-based bucket if classification is missing.
          verdict: ((): Verdict | null => {
            if (irrelevant || aiGenerated) return VERDICT_NON_COMPLIANT;
            const cls = verdictFromAny((analysis as any)?.classification);
            if (cls) return cls;
            if (analysis) {
              const s = analysis.score;
              if (s >= 80) return VERDICT_COMPLIANT;
              if (s >= 35) return VERDICT_NEEDS_REVIEW;
              return VERDICT_NON_COMPLIANT;
            }
            return null;
          })(),
          analyzed_at: analysis || irrelevant || aiGenerated ? new Date().toISOString() : null,
          issues: issues.length > 0 ? issues : null,
          passed_checks: passed.length > 0 ? passed : null,
          failed_checks: analysis?.issues?.length ? analysis.issues : null,
          compliance_score: analysis ? Math.round(analysis.score) : null,
          recommendation: irrelevant
            ? (flagResult?.reason ?? "AI flagged this photo as not a trench.")
            : aiGenerated
              ? (aiResult?.reason ?? "AI flagged this photo as synthetic.")
              : (analysis?.recommendation ?? null),
          depth_cm: analysis?.depth_cm ?? null,
          depth_pass: analysis?.depth_pass ?? null,
          ruler_visible: analysis?.ruler_visible ?? null,
          bedding_visible: analysis?.bedding_visible ?? null,
          duct_bundle_visible: analysis?.duct_bundle_visible ?? null,
          unobstructed: analysis?.unobstructed ?? null,
          image_width: dims?.width ?? null,
          image_height: dims?.height ?? null,
          file_size_bytes: file.size,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;

      updateItem(it.key, {
        state: {
          kind: "uploaded",
          photoId: inserted!.id,
          match,
          gpsSource,
          analysis,
          faceCount,
          aiGenerated: aiResult,
        },
      });
    } catch (e: unknown) {
      updateItem(it.key, { state: { kind: "error", message: errorToMessage(e) } });
    }
  }

  const coveragePhotos = useMemo(
    () =>
      items
        .filter((it) => it.state.kind === "uploaded")
        .map((it) => {
          const m = (it.state as Extract<ItemState, { kind: "uploaded" }>).match;
          return { trench_id: m.trenchId, waypoint_index: m.waypointIndex };
        }),
    [items],
  );

  const touchedTrenchIds = useMemo(
    () =>
      Array.from(
        new Set(coveragePhotos.map((p) => p.trench_id).filter((id): id is string => !!id)),
      ),
    [coveragePhotos],
  );


  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-3xl mx-auto p-4 space-y-4">
        {!site && (
          <div className="card-elevated p-4 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading site geometry…
          </div>
        )}

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`block card-elevated p-6 border-2 border-dashed cursor-pointer transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-surface"
          }`}
        >
          <div className="flex flex-col items-center text-center gap-2">
            <Upload className="w-6 h-6 text-primary" />
            <p className="text-sm font-medium">Drop photos here or click to choose</p>
            <p className="text-xs text-muted-foreground">
              JPEG/PNG/WebP with EXIF GPS, or overlay GPS/address · uploads are blocked if local
              face redaction cannot run · duplicates and synthetic images flagged
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>

        {items.length > 0 && (
          <div className="card-elevated p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <span className="font-semibold">{items.length}</span>{" "}
                <span className="text-muted-foreground">files</span>
                {noGpsCount > 0 && (
                  <span className="text-muted-foreground"> · {noGpsCount} no GPS</span>
                )}
                {readyCount > 0 && (
                  <span className="text-muted-foreground"> · {readyCount} ready</span>
                )}
                {duplicateCount > 0 && (
                  <span className="text-muted-foreground"> · {duplicateCount} duplicate</span>
                )}
                {uploadedCount > 0 && (
                  <span className="text-success"> · {uploadedCount} uploaded</span>
                )}
                {errorCount > 0 && <span className="text-danger"> · {errorCount} failed</span>}
              </div>
              <div className="flex items-center gap-2">
                {items.length > 0 && !uploading && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      for (const it of items) URL.revokeObjectURL(it.objectUrl);
                      setItems([]);
                      setProgress({ done: 0, total: 0 });
                      setDoneBatch(false);
                    }}
                  >
                    Clear
                  </Button>
                )}
                <Button size="sm" onClick={uploadAll} disabled={uploading || readyCount === 0}>
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      {progress.done}/{progress.total}
                    </>
                  ) : (
                    <>Upload {readyCount}</>
                  )}
                </Button>
              </div>
            </div>

            {uploading && progress.total > 0 && (
              <div className="w-full h-1.5 rounded-full bg-surface overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${Math.round((progress.done / progress.total) * 100)}%`,
                  }}
                />
              </div>
            )}

            <ul className="divide-y divide-border">
              {items.map((it) => (
                <li key={it.key} className="py-2 flex items-center gap-3">
                  <div className="w-12 h-12 rounded-md overflow-hidden bg-surface shrink-0 flex items-center justify-center">
                    <img src={it.objectUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{it.file.name}</div>
                    <ItemDetail state={it.state} />
                  </div>
                  <ItemBadge state={it.state} />
                  {!uploading && it.state.kind === "no_gps" && (
                    <button
                      onClick={() => void uploadNoGps(it)}
                      className="text-xs px-2 py-1 rounded-md bg-warning/15 text-warning hover:bg-warning/25"
                      title="Upload without coordinates"
                    >
                      Upload anyway
                    </button>
                  )}
                  {!uploading && it.state.kind !== "uploaded" && (
                    <button
                      onClick={() => removeItem(it.key)}
                      className="p-1 text-muted-foreground hover:text-foreground"
                      title="Remove"
                    >
                      <Ban className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {doneBatch && projectSite && touchedTrenchIds.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <MapPin className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold">Coverage report</h2>
              <span className="text-xs text-muted-foreground">(touched trenches only)</span>
            </div>
            <CoverageReport
              trenches={projectSite?.trenches ?? []}
              photos={coveragePhotos}
              filterTrenchIds={touchedTrenchIds}
              onRowClick={({ trenchId, firstCoveredWaypoint }) => {
                const fcp = trenchToFcp[trenchId];
                if (!fcp) return;
                void navigate({
                  to: "/dashboard",
                  search: {
                    fcp,
                    trench: trenchId,
                    waypoint: firstCoveredWaypoint ?? undefined,
                  },
                });
              }}
            />
          </section>
        )}

        {doneBatch && (
          <div className="flex justify-center">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90"
              >
                ← Back
              </button>
            ) : (
              <a
                href={backHref ?? "/"}
                className="text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90"
              >
                ← Back
              </a>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function ItemDetail({ state }: { state: ItemState }) {
  switch (state.kind) {
    case "scanning":
      return (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />{" "}
          {state.phase === "geocode"
            ? "No coordinates — geocoding address…"
            : state.phase === "ocr"
              ? "No EXIF — OCRing overlay…"
              : state.phase === "blur"
                ? "Blurring faces for GDPR…"
                : "Reading EXIF…"}
        </div>
      );
    case "no_gps":
      return (
        <div className="text-xs text-warning">
          No GPS in EXIF and overlay OCR failed — cannot place.
        </div>
      );
    case "ready":
    case "uploaded": {
      const m = state.match;
      const parts: string[] = [];
      if (m.fcpId) parts.push(`FCP ${m.fcpId}`);
      else parts.push("no FCP");
      if (m.trenchId) parts.push(m.trenchId);
      if (m.waypointIndex != null) parts.push(`wp #${m.waypointIndex}`);
      if (m.distanceToWaypointM != null) parts.push(`±${m.distanceToWaypointM.toFixed(1)} m`);
      const analysis = state.kind === "uploaded" ? state.analysis : null;
      const ai = state.kind === "uploaded" ? state.aiGenerated : null;
      return (
        <div className="text-xs text-muted-foreground font-mono truncate">
          {parts.join(" · ")}
          {state.gpsSource === "ocr" && <span className="text-primary"> · gps from overlay</span>}
          {state.gpsSource === "geocode" && (
            <span className="text-primary"> · gps from address</span>
          )}
          {state.faceCount > 0 && (
            <span className="text-primary">
              {" "}
              · {state.faceCount} face{state.faceCount > 1 ? "s" : ""} blurred
            </span>
          )}
          {m.issues.length > 0 && <span className="text-warning"> · {m.issues.join(", ")}</span>}
          {ai && ai.is_ai_generated && ai.confidence >= 0.5 && (
            <span className="text-danger">
              {" "}
              · AI-generated ({(ai.confidence * 100).toFixed(0)}%)
            </span>
          )}
          {analysis && (
            <span className={analysis.compliant ? "text-success" : "text-danger"}>
              {" "}
              · {analysis.compliant ? "compliant" : "flagged"} {Math.round(analysis.score)}/100
              {analysis.depth_cm != null && ` · ${analysis.depth_cm}cm`}
            </span>
          )}
        </div>
      );
    }
    case "uploading":
      return (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Uploading + classifying…
        </div>
      );
    case "duplicate":
      return (
        <div className="text-xs text-muted-foreground">
          Already imported (same sha256) — skipped.
        </div>
      );
    case "error":
      return <div className="text-xs text-danger truncate">Failed: {state.message}</div>;
  }
}

function ItemBadge({ state }: { state: ItemState }) {
  const base = "text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full shrink-0";
  switch (state.kind) {
    case "scanning":
      return (
        <span className={`${base} bg-surface text-muted-foreground flex items-center gap-1`}>
          {state.phase === "ocr" || state.phase === "geocode" ? (
            <ScanText className="w-3 h-3" />
          ) : state.phase === "blur" ? (
            <ShieldCheck className="w-3 h-3" />
          ) : null}
          {state.phase === "geocode"
            ? "geocode"
            : state.phase === "ocr"
              ? "ocr"
              : state.phase === "blur"
                ? "blurring"
                : "scanning"}
        </span>
      );
    case "no_gps":
      return (
        <span className={`${base} bg-warning/15 text-warning flex items-center gap-1`}>
          <AlertTriangle className="w-3 h-3" /> no gps
        </span>
      );
    case "ready":
      return (
        <span
          className={`${base} ${
            state.match.status === "flagged"
              ? "bg-warning/15 text-warning"
              : "bg-primary/15 text-primary"
          }`}
        >
          {state.match.status === "flagged" ? "flagged" : "ready"}
        </span>
      );
    case "uploading":
      return <span className={`${base} bg-surface text-muted-foreground`}>uploading</span>;
    case "duplicate":
      return <span className={`${base} bg-surface text-muted-foreground`}>duplicate</span>;
    case "uploaded":
      return (
        <span className={`${base} bg-success/15 text-success flex items-center gap-1`}>
          <CheckCircle2 className="w-3 h-3" /> uploaded
        </span>
      );
    case "error":
      return <span className={`${base} bg-danger/15 text-danger`}>error</span>;
    default:
      return (
        <span className={`${base} bg-surface text-muted-foreground`}>
          <ImageIcon className="w-3 h-3" />
        </span>
      );
  }
}
