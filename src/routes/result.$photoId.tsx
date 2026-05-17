import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  validatePhoto,
  verdictFromAny,
  VERDICT_COMPLIANT,
  VERDICT_NEEDS_REVIEW,
  VERDICT_NON_COMPLIANT,
  type Verdict,
} from "@/lib/validate-photo.functions";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, ArrowLeft, RotateCcw, Ruler, Maximize2, MapPin, Copy, Calendar } from "lucide-react";
import { motion } from "framer-motion";

export const Route = createFileRoute("/result/$photoId")({
  component: ResultPage,
});

const CHECK_LABELS: Record<string, string> = {
  DEPTH_TOO_SHALLOW: "Depth below 60 cm",
  RULER_MISSING: "No measuring ruler visible",
  BEDDING_MISSING: "Sand bedding not visible",
  DUCT_NOT_VISIBLE: "Duct bundle not visible",
  PIPE_ENDS_CUT_OFF: "Pipe ends out of frame",
  OBSTRUCTED: "View obstructed",
  LENGTH_UNCLEAR: "Length cannot be estimated",
};

type Analysis = {
  depth_cm: number | null;
  depth_pass: boolean;
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
  min_depth_cm: number;
};

const MIN_DEPTH_CM = 60;

function ResultPage() {
  const { photoId } = Route.useParams();
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [duplicates, setDuplicates] = useState<{ id: string; filename: string | null; created_at: string | null }[]>([]);
  const validate = useServerFn(validatePhoto);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("images").select("*").eq("id", photoId).single();
      setPhoto(data);
      setLoading(false);

      // Look up duplicates by sha256 (excluding this photo itself)
      if (data?.sha256) {
        const { data: dups } = await supabase
          .from("images")
          .select("id, filename, created_at")
          .eq("sha256", data.sha256)
          .neq("id", photoId);
        setDuplicates(dups ?? []);
      }

      if (data && data.status === "pending") {
        setAnalyzing(true);
        try {
          const r = (await validate({ data: { imageUrl: data.image_url } })) as Analysis;
          const passed: string[] = [];
          if (r.depth_pass) passed.push("DEPTH_OK");
          if (r.ruler_visible) passed.push("RULER_OK");
          if (r.bedding_visible) passed.push("BEDDING_OK");
          if (r.duct_bundle_visible) passed.push("DUCT_OK");
          if (r.pipe_ends_visible) passed.push("PIPE_ENDS_OK");
          if (r.unobstructed) passed.push("UNOBSTRUCTED_OK");
          if (r.visible_length_m != null) passed.push("LENGTH_OK");

          const verdict: Verdict = (() => {
            const cls = verdictFromAny((r as any).classification);
            if (cls) return cls;
            if (typeof r.score === "number") {
              if (r.score >= 80) return VERDICT_COMPLIANT;
              if (r.score >= 35) return VERDICT_NEEDS_REVIEW;
            }
            return r.compliant ? VERDICT_COMPLIANT : VERDICT_NON_COMPLIANT;
          })();
          await supabase
            .from("images")
            .update({
              compliance_score: r.score,
              passed_checks: passed,
              failed_checks: r.issues,
              issues: r.issues,
              recommendation: r.recommendation,
              status: "analyzed",
              verdict,
              analyzed_at: new Date().toISOString(),
              depth_cm: r.depth_cm,
              depth_pass: r.depth_pass,
              ruler_visible: r.ruler_visible,
              bedding_visible: r.bedding_visible,
              duct_bundle_visible: r.duct_bundle_visible,
              unobstructed: r.unobstructed,
            })
            .eq("id", photoId);
          const { data: updated } = await supabase.from("images").select("*").eq("id", photoId).single();
          setPhoto(updated);
        } catch (e) {
          console.error(e);
        } finally {
          setAnalyzing(false);
        }
      }
    })();
  }, [photoId, validate]);

  if (loading || !photo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  }

  const isIrrelevant = photo.status === "irrelevant";
  // Normalize the verdict to the new 3-class system. Older rows may still
  // have "compliant"/"non_compliant"/"needs_review".
  const photoClass: "green" | "yellow" | "red" | null = (() => {
    const v = photo.verdict;
    if (v === "green" || v === "compliant") return "green";
    if (v === "yellow" || v === "needs_review") return "yellow";
    if (v === "red" || v === "non_compliant") return "red";
    return null;
  })();
  const isCompliant = photoClass === "green";
  const isAnalyzing = !isIrrelevant && (analyzing || photo.status === "pending");
  const aiSubject = ((photo.issues ?? []) as string[])
    .find((i) => i.startsWith("ai_subject:"))
    ?.slice("ai_subject:".length);
  const score = photo.compliance_score ?? 0;

  // Prefer the structured columns; fall back to legacy M: entries in passed_checks.
  const legacy: Record<string, string> = {};
  for (const c of (photo.passed_checks ?? []) as string[]) {
    if (c.startsWith("M:")) {
      const [k, v] = c.slice(2).split("=");
      legacy[k] = v;
    }
  }
  const depthCm = photo.depth_cm ?? (legacy.depth_cm ? Number(legacy.depth_cm) : null);
  const depthPass = photo.depth_pass ?? legacy.depth_pass === "1";

  // Parse the distance/match issues that match-photo.ts and the GPS pipeline
  // wrote during import: far_from_waypoint:Xm, off_site:Xm, wrong_fcp:F012,
  // gps_from_overlay, gps_from_address, unknown_fcp:..., unknown_trench:..., no_gps.
  const issuesList = (photo.issues ?? []) as string[];
  const parsedDistance = issuesList
    .find((i) => i.startsWith("far_from_waypoint:") || i.startsWith("off_site:"))
    ?.match(/(\d+)\s*m/)?.[1];
  // Snap audit fields written by PhotoImporter when match-photo produced a waypoint.
  const snapMeters = issuesList.find((i) => i.startsWith("snapped:"))?.slice("snapped:".length);
  const originalGps = issuesList.find((i) => i.startsWith("original_gps:"))?.slice("original_gps:".length);
  const wrongFcp = issuesList.find((i) => i.startsWith("wrong_fcp:"))?.slice("wrong_fcp:".length);
  const unknownFcp = issuesList.find((i) => i.startsWith("unknown_fcp:"))?.slice("unknown_fcp:".length);
  const unknownTrench = issuesList.find((i) => i.startsWith("unknown_trench:"))?.slice("unknown_trench:".length);
  const gpsSource = issuesList.includes("gps_from_overlay")
    ? "OCR overlay"
    : issuesList.includes("gps_from_address")
      ? "geocoded address"
      : issuesList.includes("no_gps")
        ? "missing"
        : "EXIF";
  const onPoint = !parsedDistance && !wrongFcp && !issuesList.includes("no_gps");

  const lat = photo.latitude as number | null;
  const lng = photo.longitude as number | null;
  const hasGps = lat != null && lng != null;
  const mapsUrl = hasGps ? `https://www.google.com/maps?q=${lat},${lng}` : null;
  const capturedAt = photo.captured_at ? new Date(photo.captured_at) : null;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 max-w-md mx-auto space-y-4">
      <header className="pt-2 flex items-center gap-2">
        {photo.project_id ? (
          <Link
            to="/project/$projectId"
            params={{ projectId: photo.project_id }}
            className="p-1.5 rounded-md hover:bg-surface"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
        ) : (
          <Link
            to="/zone/$fcpId"
            params={{ fcpId: photo.fcp_id ?? "" }}
            className="p-1.5 rounded-md hover:bg-surface"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
        )}
        <div>
          <h1 className="text-xl font-bold">Inspection result</h1>
          <p className="text-xs text-muted-foreground font-mono">{photo.fcp_id}</p>
        </div>
      </header>

      <div className="card-elevated overflow-hidden">
        <img src={photo.image_url} alt="" className="w-full aspect-[4/3] object-cover" />
      </div>

      {/* Location + capture metadata */}
      <div className="card-elevated p-4 space-y-2">
        <p className="text-xs uppercase text-muted-foreground tracking-wide">Location</p>
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            {hasGps ? (
              <>
                <a
                  href={mapsUrl!}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs underline hover:text-primary"
                >
                  {lat!.toFixed(6)}, {lng!.toFixed(6)}
                </a>
                <p className="text-[11px] text-muted-foreground">
                  GPS source: <span className="text-foreground">{gpsSource}</span>
                </p>
              </>
            ) : (
              <p className="text-xs text-warning">No coordinates recorded.</p>
            )}
          </div>
          {hasGps && (
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(`${lat},${lng}`)}
              className="p-1 text-muted-foreground hover:text-foreground"
              aria-label="Copy coordinates"
              title="Copy coordinates"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {capturedAt && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Calendar className="w-3.5 h-3.5" />
            {capturedAt.toLocaleString()}
          </div>
        )}
        {photo.filename && (
          <p className="text-[11px] font-mono text-muted-foreground truncate" title={photo.filename}>
            {photo.filename}
          </p>
        )}
      </div>

      {/* Match-to-expected coordinate */}
      <div
        className={`card-elevated p-4 space-y-2 ${
          onPoint ? "border-success/40" : wrongFcp || parsedDistance ? "border-warning/40" : ""
        }`}
      >
        <p className="text-xs uppercase text-muted-foreground tracking-wide">Match to expected point</p>
        {onPoint && (
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="w-4 h-4" />
            Photo matches the assigned waypoint.
          </div>
        )}
        {parsedDistance && (
          <div className="flex items-center gap-2 text-sm text-warning">
            <XCircle className="w-4 h-4" />
            {parsedDistance} m away from the nearest waypoint.
          </div>
        )}
        {snapMeters && (
          <p className="text-[11px] text-muted-foreground">
            Coordinates snapped to the closest 5 m waypoint ({snapMeters} from the raw GPS reading).
          </p>
        )}
        {originalGps && (
          <p className="text-[11px] font-mono text-muted-foreground">
            Original GPS: {originalGps}
          </p>
        )}
        {wrongFcp && (
          <div className="flex items-center gap-2 text-sm text-warning">
            <XCircle className="w-4 h-4" />
            Snapped to a different FCP ({wrongFcp}).
          </div>
        )}
        {issuesList.includes("no_gps") && (
          <div className="flex items-center gap-2 text-sm text-warning">
            <XCircle className="w-4 h-4" />
            No GPS coordinates — uploaded without location.
          </div>
        )}
        <div className="text-[11px] text-muted-foreground space-y-0.5 pt-1">
          {photo.fcp_id && <p>FCP: <span className="font-mono">{photo.fcp_id}</span></p>}
          {photo.trench_id && <p>Trench: <span className="font-mono">{photo.trench_id}</span></p>}
          {unknownFcp && (
            <p className="text-warning">Unrecognized FCP code from GPS match: {unknownFcp}</p>
          )}
          {unknownTrench && (
            <p className="text-warning">Unrecognized trench code from GPS match: {unknownTrench}</p>
          )}
        </div>
      </div>

      {/* Duplicates */}
      {duplicates.length > 0 && (
        <div className="card-elevated p-4 space-y-2 border-warning/40">
          <p className="text-xs uppercase text-muted-foreground tracking-wide">
            {duplicates.length} duplicate{duplicates.length === 1 ? "" : "s"} (same SHA-256)
          </p>
          <div className="space-y-1">
            {duplicates.slice(0, 5).map((d) => (
              <Link
                key={d.id}
                to="/result/$photoId"
                params={{ photoId: d.id }}
                className="block text-xs text-primary hover:underline truncate font-mono"
              >
                {d.filename ?? d.id.slice(0, 8)}
                {d.created_at && (
                  <span className="text-muted-foreground"> · {new Date(d.created_at).toLocaleDateString()}</span>
                )}
              </Link>
            ))}
            {duplicates.length > 5 && (
              <p className="text-[11px] text-muted-foreground">+{duplicates.length - 5} more</p>
            )}
          </div>
        </div>
      )}

      {isIrrelevant ? (
        <div className="card-elevated p-6 space-y-3 border-danger/40">
          <div className="flex items-center gap-2">
            <XCircle className="w-6 h-6 text-danger" />
            <div className="text-lg font-bold text-danger">Not a trench photo</div>
          </div>
          {aiSubject && (
            <p className="text-sm">
              <span className="text-muted-foreground">AI saw:</span> {aiSubject}
            </p>
          )}
          {photo.recommendation && (
            <p className="text-xs text-muted-foreground">{photo.recommendation}</p>
          )}
          <Button
            onClick={() => navigate({ to: "/zone/$fcpId", params: { fcpId: photo.fcp_id ?? "" } })}
            className="w-full"
            variant="destructive"
            size="lg"
          >
            <RotateCcw className="mr-2 w-4 h-4" /> Retake the photo
          </Button>
        </div>
      ) : isAnalyzing ? (
        <div className="card-elevated p-6 flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm">Analyzing trench with AI…</p>
          <p className="text-xs text-muted-foreground">Reading depth & measuring length</p>
        </div>
      ) : (
        <>
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="card-elevated p-6 flex items-center gap-4"
          >
            <ScoreRing score={score} compliant={isCompliant} />
            <div>
              {photoClass === "green" && (
                <div className="text-lg font-bold text-emerald-500">COMPLIANT</div>
              )}
              {photoClass === "yellow" && (
                <div className="text-lg font-bold text-amber-500">NEEDS REVIEW</div>
              )}
              {photoClass === "red" && (
                <div className="text-lg font-bold text-red-500">NON-COMPLIANT</div>
              )}
              {!photoClass && (
                <div className="text-lg font-bold text-muted-foreground">UNCLASSIFIED</div>
              )}
              <div className="text-xs text-muted-foreground">
                Score {Math.round(score)}/100
                {photoClass && (
                  <>
                    {" · "}
                    {photoClass === "green"
                      ? "All required items visible"
                      : photoClass === "yellow"
                        ? "Trench + cables, some items missing"
                        : "No trench / no cables"}
                  </>
                )}
              </div>
            </div>
          </motion.div>

          <div className="card-elevated p-4">
            <div className={`${depthCm != null && !depthPass ? "border-danger/40" : depthPass ? "border-success/40" : ""}`}>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                <Ruler className="w-3.5 h-3.5" /> Depth
              </div>
              <div className="text-2xl font-bold">
                {depthCm != null ? `${depthCm}` : "—"}
                {depthCm != null && <span className="text-sm font-normal text-muted-foreground ml-1">cm</span>}
              </div>
              <div className={`text-xs mt-1 ${depthPass ? "text-success" : "text-danger"}`}>
                {depthCm == null
                  ? "no ruler in frame"
                  : depthPass
                    ? `✓ ≥ ${MIN_DEPTH_CM} cm`
                    : `✗ needs ${MIN_DEPTH_CM} cm`}
              </div>
            </div>
          </div>

          {(photo.failed_checks?.length ?? 0) > 0 && (
            <div className="card-elevated p-4 space-y-2 border-danger/30">
              <p className="text-xs uppercase text-muted-foreground tracking-wide">Issues</p>
              {(photo.failed_checks as string[]).map((c, i) => (
                <motion.div
                  key={c + i}
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-2 text-sm"
                >
                  <XCircle className="w-4 h-4 text-danger shrink-0" />
                  {CHECK_LABELS[c] ?? c}
                </motion.div>
              ))}
              {photo.recommendation && (
                <p className="text-xs text-warning mt-2 pt-2 border-t border-border">
                  💡 {photo.recommendation}
                </p>
              )}
            </div>
          )}

          {(photo.passed_checks ?? []).filter((c: string) => !c.startsWith("M:")).length > 0 && (
            <div className="card-elevated p-4 space-y-2">
              <p className="text-xs uppercase text-muted-foreground tracking-wide">Passed</p>
              {(photo.passed_checks as string[])
                .filter((c) => !c.startsWith("M:"))
                .map((c, i) => (
                  <div key={c + i} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                    {CHECK_LABELS[c] ?? c.replace(/_OK$/, "").toLowerCase()}
                  </div>
                ))}
            </div>
          )}

          {isCompliant ? (
            <Button
              onClick={() =>
                photo.project_id
                  ? navigate({ to: "/project/$projectId", params: { projectId: photo.project_id } })
                  : navigate({ to: "/zone/$fcpId", params: { fcpId: photo.fcp_id ?? "" } })
              }
              className="w-full"
              size="lg"
            >
              {photo.project_id ? "Back to project" : "Back to zone"}
            </Button>
          ) : (
            <Button
              onClick={() => navigate({ to: "/zone/$fcpId", params: { fcpId: photo.fcp_id ?? "" } })}
              className="w-full"
              size="lg"
              variant="destructive"
            >
              <RotateCcw className="mr-2 w-4 h-4" /> Retake at another point
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function ScoreRing({ score, compliant }: { score: number; compliant: boolean }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const off = c - (c * score) / 100;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72">
      <circle cx="36" cy="36" r={r} stroke="var(--border)" strokeWidth="6" fill="none" />
      <motion.circle
        cx="36"
        cy="36"
        r={r}
        stroke={compliant ? "var(--success)" : "var(--danger)"}
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: off }}
        transition={{ duration: 1.2, ease: "easeOut" }}
        transform="rotate(-90 36 36)"
      />
      <text
        x="36"
        y="40"
        textAnchor="middle"
        fill="currentColor"
        fontSize="16"
        fontWeight="700"
      >
        {Math.round(score)}
      </text>
    </svg>
  );
}
