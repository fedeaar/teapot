import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RefreshCw, MapPin, ImageOff, Trash2, Loader2, MoreVertical, Eye, Map, Sparkles, MapPinned, Check } from "lucide-react";
import { toast } from "sonner";
import { loadSiteData } from "@/lib/site-data";
import { siteDataToProjectData } from "@/lib/site-adapter";
import { matchPhotoToWaypoint, isOffSite } from "@/lib/match-photo";
import {
  validatePhoto,
  verdictFromAny,
  VERDICT_COMPLIANT,
  VERDICT_NEEDS_REVIEW,
  VERDICT_NON_COMPLIANT,
  type Verdict,
} from "@/lib/validate-photo.functions";

type PhotoRow = {
  id: string;
  image_url: string;
  latitude: number | null;
  longitude: number | null;
  captured_at: string;
  created_at: string;
  fcp_id: string | null;
  trench_id: string | null;
  status: string;
  verdict: string | null;
  issues: string[] | null;
};

export type UploadedPhotosSectionHandle = { refresh: () => void };

export function UploadedPhotosSection({
  refreshKey = 0,
  onShowOnMap,
  onValidate,
}: {
  refreshKey?: number;
  onShowOnMap?: (photo: { id: string; latitude: number; longitude: number; fcp_id: string | null }) => void;
  onValidate?: (photoId: string) => void;
}) {
  const [photos, setPhotos] = useState<PhotoRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PhotoRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resnapping, setResnapping] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reevaluating, setReevaluating] = useState(false);
  const [reevalProgress, setReevalProgress] = useState({ done: 0, total: 0 });
  const navigate = useNavigate();
  const validate = useServerFn(validatePhoto);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set((photos ?? []).map((p) => p.id)));
  }, [photos]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("images")
      .select(
        "id,image_url,latitude,longitude,captured_at,created_at,fcp_id,trench_id,status,verdict,issues",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (!error) setPhotos((data ?? []) as PhotoRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const handleDelete = useCallback(
    async (photo: PhotoRow) => {
      if (!confirm("Delete this photo and its analysis? This cannot be undone.")) return;
      setDeletingId(photo.id);
      try {
        // Best-effort: remove the underlying storage object too.
        try {
          const url = new URL(photo.image_url);
          const marker = "/storage/v1/object/public/photos/";
          const idx = url.pathname.indexOf(marker);
          if (idx !== -1) {
            const path = decodeURIComponent(url.pathname.slice(idx + marker.length));
            await supabase.storage.from("photos").remove([path]);
          }
        } catch {
          // ignore storage cleanup errors — DB delete is the source of truth
        }
        const { error } = await supabase.from("images").delete().eq("id", photo.id);
        if (error) throw error;
        setPhotos((prev) => (prev ? prev.filter((p) => p.id !== photo.id) : prev));
        if (preview?.id === photo.id) setPreview(null);
        toast.success("Photo deleted");
      } catch (err) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "Failed to delete photo");
      } finally {
        setDeletingId(null);
      }
    },
    [preview],
  );

  // Re-runs the Gemini compliance analysis (validatePhoto) on the selected
  // photos and writes the new score / verdict / per-check booleans / issues
  // back to the DB. The non-Gemini issue markers (no_gps, original_gps:…,
  // snapped:…, far_from_waypoint:…, IRRELEVANT, AI_GENERATED, etc.) are
  // preserved so the snap/match information isn't wiped.
  const reevaluateSelected = useCallback(async () => {
    if (!photos || selectedIds.size === 0 || reevaluating) return;
    const targets = photos.filter((p) => selectedIds.has(p.id));
    if (targets.length === 0) return;
    setReevaluating(true);
    setReevalProgress({ done: 0, total: targets.length });

    // Issue prefixes / exact codes that come from the Gemini compliance call.
    // Anything matching these gets dropped before merging in the fresh analysis;
    // everything else (snap markers, GPS source, AI/IRRELEVANT flags) survives.
    const GEMINI_ISSUE_PREFIXES = [
      "DEPTH_",
      "RULER_",
      "BEDDING_",
      "DUCT_",
      "PIPE_",
      "OBSTRUCTED",
      "LENGTH_",
      "WARNING_TAPE_",
      "SIDE_VIEW_",
      "NOT_A_TRENCH",
    ];
    const isGeminiIssue = (s: string) => GEMINI_ISSUE_PREFIXES.some((p) => s.startsWith(p));

    let done = 0;
    let updatedRows: PhotoRow[] = [...photos];
    let failures = 0;
    let skippedOffSite = 0;
    for (const p of targets) {
      // Skip off-site photos: the matcher already determined this image
      // isn't on the construction site, so an AI compliance score would be
      // meaningless. Counted separately so the toast doesn't read as a failure.
      if (isOffSite((p.issues ?? []) as string[])) {
        skippedOffSite++;
        done++;
        setReevalProgress({ done, total: targets.length });
        continue;
      }
      try {
        const r = (await validate({ data: { imageUrl: p.image_url } })) as any;
        const passed: string[] = [];
        if (r.depth_pass) passed.push("DEPTH_OK");
        if (r.ruler_visible) passed.push("RULER_OK");
        if (r.bedding_visible) passed.push("BEDDING_OK");
        if (r.duct_bundle_visible) passed.push("DUCT_OK");
        if (r.pipe_ends_visible) passed.push("PIPE_ENDS_OK");
        if (r.unobstructed) passed.push("UNOBSTRUCTED_OK");
        if (r.visible_length_m != null) passed.push("LENGTH_OK");
        if (r.warning_tape_visible) passed.push("WARNING_TAPE_OK");
        if (r.side_view_visible) passed.push("SIDE_VIEW_OK");

        // Merge preserved (non-Gemini) issues with the freshly produced ones.
        const preserved = (p.issues ?? []).filter((i) => !isGeminiIssue(i));
        const mergedIssues = [...preserved, ...((r.issues ?? []) as string[])];

        // The model now emits the canonical verdict directly. Non-trench
        // photos collapse to non_compliant. Score is the fallback when the
        // model omits classification or returns something unexpected.
        const verdict: Verdict = (() => {
          if (r.is_trench_photo === false) return VERDICT_NON_COMPLIANT;
          const cls = verdictFromAny(r.classification);
          if (cls) return cls;
          if (typeof r.score === "number") {
            if (r.score >= 80) return VERDICT_COMPLIANT;
            if (r.score >= 35) return VERDICT_NEEDS_REVIEW;
          }
          return r.compliant ? VERDICT_COMPLIANT : VERDICT_NON_COMPLIANT;
        })();
        const status =
          verdict === VERDICT_COMPLIANT
            ? "compliant"
            : verdict === VERDICT_NON_COMPLIANT
              ? r.is_trench_photo === false
                ? "irrelevant"
                : "flagged"
              : "flagged";

        const { error } = await supabase
          .from("images")
          .update({
            compliance_score: Math.round(r.score),
            passed_checks: passed.length > 0 ? passed : null,
            failed_checks: r.issues?.length ? r.issues : null,
            issues: mergedIssues.length > 0 ? mergedIssues : null,
            recommendation: r.recommendation ?? null,
            status,
            verdict,
            analyzed_at: new Date().toISOString(),
            depth_cm: r.depth_cm,
            depth_pass: r.depth_pass,
            ruler_visible: r.ruler_visible,
            bedding_visible: r.bedding_visible,
            duct_bundle_visible: r.duct_bundle_visible,
            unobstructed: r.unobstructed,
          })
          .eq("id", p.id);
        if (error) throw error;

        updatedRows = updatedRows.map((row) =>
          row.id === p.id
            ? {
                ...row,
                status,
                verdict,
                issues: mergedIssues.length > 0 ? mergedIssues : null,
              }
            : row,
        );
      } catch (err) {
        console.error("[reevaluate] failed for", p.id, err);
        failures++;
      } finally {
        done++;
        setReevalProgress({ done, total: targets.length });
      }
    }

    setPhotos(updatedRows);
    setSelectedIds(new Set());
    setReevaluating(false);
    const evaluated = targets.length - failures - skippedOffSite;
    const skipMsg = skippedOffSite > 0 ? ` (${skippedOffSite} skipped: off-site)` : "";
    if (failures === 0) {
      toast.success(`Re-evaluated ${evaluated} photo${evaluated === 1 ? "" : "s"}${skipMsg}`);
    } else {
      toast.error(`Re-evaluated ${evaluated}/${targets.length}; ${failures} failed${skipMsg}`);
    }
  }, [photos, selectedIds, reevaluating, validate]);

  // Re-runs the photo→waypoint matcher against the bundled geojson geometry
  // for every photo with usable coordinates. Photos whose `issues` array has
  // an `original_gps:lat,lng` marker re-snap from the raw GPS reading;
  // everything else re-snaps from its currently stored coordinate (which
  // may already be a previous snap — re-snapping is idempotent on a clean
  // snap, since (lat,lng) is then exactly the waypoint).
  const resnapAll = useCallback(async () => {
    if (!photos || photos.length === 0 || resnapping) return;
    setResnapping(true);
    try {
      const project = siteDataToProjectData(await loadSiteData());
      let touched = 0;
      const next: PhotoRow[] = [];
      for (const p of photos) {
        // Find the raw GPS we should re-match against.
        const issues = (p.issues ?? []) as string[];
        const originalMarker = issues.find((i) => i.startsWith("original_gps:"));
        let srcLat: number | null = null;
        let srcLng: number | null = null;
        if (originalMarker) {
          const [latStr, lngStr] = originalMarker.slice("original_gps:".length).split(",");
          srcLat = Number(latStr);
          srcLng = Number(lngStr);
        } else {
          srcLat = p.latitude;
          srcLng = p.longitude;
        }
        if (srcLat == null || srcLng == null || !Number.isFinite(srcLat) || !Number.isFinite(srcLng)) {
          next.push(p);
          continue;
        }

        const match = matchPhotoToWaypoint({ lat: srcLat, lng: srcLng }, project);

        // Strip stale snap / distance markers but keep everything else
        // (Gemini-derived issues, no_gps, gps_from_overlay, address:…, etc.).
        const STRIP_PREFIXES = [
          "original_gps:",
          "snapped:",
          "far_from_waypoint:",
          "off_site",
          "wrong_fcp:",
        ];
        const preserved = issues.filter(
          (i) => !STRIP_PREFIXES.some((pref) => i === pref || i.startsWith(pref)),
        );
        const newIssues: string[] = [...preserved, ...match.issues];
        let storedLat = srcLat;
        let storedLng = srcLng;
        if (match.waypointLat != null && match.waypointLng != null) {
          storedLat = match.waypointLat;
          storedLng = match.waypointLng;
          newIssues.push(`original_gps:${srcLat.toFixed(6)},${srcLng.toFixed(6)}`);
          if (match.distanceToWaypointM != null) {
            newIssues.push(`snapped:${match.distanceToWaypointM.toFixed(1)}m`);
          }
        }

        const { error } = await supabase
          .from("images")
          .update({
            latitude: storedLat,
            longitude: storedLng,
            issues: newIssues.length > 0 ? newIssues : null,
          })
          .eq("id", p.id);
        if (error) {
          console.error("[resnap] update failed for", p.id, error);
          next.push(p);
          continue;
        }
        touched++;
        next.push({
          ...p,
          latitude: storedLat,
          longitude: storedLng,
          issues: newIssues.length > 0 ? newIssues : null,
        });
      }
      setPhotos(next);
      toast.success(`Re-snapped ${touched} photo${touched === 1 ? "" : "s"}`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Re-snap failed");
    } finally {
      setResnapping(false);
    }
  }, [photos, resnapping]);

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold">Uploaded photos</h2>
          <p className="text-sm text-muted-foreground">
            {photos === null
              ? "Loading…"
              : `${photos.length} photo${photos.length === 1 ? "" : "s"} on record`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {selectedIds.size > 0 && (
            <>
              <span className="text-xs text-muted-foreground mr-1">
                {selectedIds.size} selected
              </span>
              <Button variant="ghost" size="sm" onClick={clearSelection} disabled={reevaluating}>
                Clear
              </Button>
            </>
          )}
          {photos && photos.length > 0 && selectedIds.size < photos.length && (
            <Button variant="ghost" size="sm" onClick={selectAll} disabled={reevaluating}>
              Select all
            </Button>
          )}
          <Button
            size="sm"
            onClick={reevaluateSelected}
            disabled={reevaluating || selectedIds.size === 0}
          >
            {reevaluating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Re-evaluating {reevalProgress.done}/{reevalProgress.total}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Re-evaluate selected
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={resnapAll}
            disabled={resnapping || loading || !photos || photos.length === 0 || reevaluating}
          >
            {resnapping ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <MapPinned className="h-4 w-4 mr-2" />
            )}
            Re-snap to waypoints
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading || reevaluating}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {photos === null ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      ) : photos.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground flex flex-col items-center gap-2">
          <ImageOff className="h-8 w-8" />
          <p>No photos uploaded yet.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {photos.map((p) => (
            <PhotoCard
              key={p.id}
              photo={p}
              onPreview={() => navigate({ to: "/result/$photoId", params: { photoId: p.id } })}
              onQuickView={() => setPreview(p)}
              onDelete={() => handleDelete(p)}
              onShowOnMap={onShowOnMap && p.latitude != null && p.longitude != null
                ? () => onShowOnMap({ id: p.id, latitude: p.latitude!, longitude: p.longitude!, fcp_id: p.fcp_id })
                : undefined}
              onValidate={onValidate ? () => onValidate(p.id) : undefined}
              deleting={deletingId === p.id}
              selected={selectedIds.has(p.id)}
              onToggleSelect={() => toggleSelected(p.id)}
            />
          ))}
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <img
            src={preview.image_url}
            alt=""
            className="max-h-[90vh] max-w-[95vw] object-contain rounded-md shadow-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
}

function PhotoCard({
  photo,
  onPreview,
  onQuickView,
  onDelete,
  onShowOnMap,
  onValidate,
  deleting,
  selected,
  onToggleSelect,
}: {
  photo: PhotoRow;
  onPreview: () => void;
  onQuickView: () => void;
  onDelete: () => void;
  onShowOnMap?: () => void;
  onValidate?: () => void;
  deleting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasGps = photo.latitude != null && photo.longitude != null;

  // Prefer verdict (which mirrors the score-based compliance decision); fall
  // back to status for photos that haven't been analyzed yet, or which are
  // irrelevant / no-gps uploads.
  // verdict stores the canonical compliance string. Legacy traffic-light
  // strings ("green"/"yellow"/"red") still map cleanly via the same colours.
  const stateBadge = (() => {
    if (photo.verdict === "compliant" || photo.verdict === "green") {
      return { label: "Compliant", className: "bg-emerald-600 text-white" };
    }
    if (photo.verdict === "needs_review" || photo.verdict === "yellow") {
      return { label: "Needs review", className: "bg-amber-500 text-white" };
    }
    if (photo.verdict === "non_compliant" || photo.verdict === "red") {
      return { label: "Non-compliant", className: "bg-red-600 text-white" };
    }
    if (photo.status === "irrelevant") {
      return { label: "Non-compliant", className: "bg-red-600 text-white" };
    }
    if (photo.status === "compliant") {
      return { label: "Compliant", className: "bg-emerald-600 text-white" };
    }
    if (photo.status === "flagged") {
      return { label: "Needs review", className: "bg-amber-500 text-white" };
    }
    if (photo.status === "pending") {
      return { label: "Pending", className: "bg-slate-600 text-white" };
    }
    return null;
  })();

  const gpsSource = photo.issues?.includes("gps_from_address")
    ? "geocoded"
    : photo.issues?.includes("gps_from_overlay")
      ? "ocr"
      : hasGps
        ? "exif"
        : "no gps";

  const captured = new Date(photo.captured_at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  return (
    <div className="relative group/card">
      <div
        role="button"
        tabIndex={0}
        onClick={onPreview}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPreview();
          }
        }}
        className="text-left w-full cursor-pointer"
      >
        <Card
          className={`overflow-hidden group transition-all ${
            selected
              ? "ring-2 ring-primary"
              : "hover:ring-2 hover:ring-primary/40"
          }`}
        >
          <div className="aspect-square relative bg-muted">
            <img
              src={photo.image_url}
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Selection checkbox — stops propagation so it doesn't open the review page. */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleSelect();
              }}
              aria-pressed={selected}
              aria-label={selected ? "Deselect" : "Select"}
              className={`absolute bottom-2 left-2 z-20 inline-flex items-center justify-center h-6 w-6 rounded-md border shadow-sm transition ${
                selected
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background/90 border-border text-transparent hover:text-muted-foreground opacity-0 group-hover/card:opacity-100"
              }`}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            {stateBadge && (
              <Badge className={`absolute top-2 right-2 ${stateBadge.className} border-0`}>
                {stateBadge.label}
              </Badge>
            )}
            <Badge
              variant="secondary"
              className="absolute top-2 left-2 text-[10px] uppercase tracking-wide"
            >
              {gpsSource}
            </Badge>

            {/* ... menu button — anchored to the bottom-right of the image */}
            <div ref={menuRef} className="absolute bottom-2 right-2 z-20">
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen((v) => !v); }}
                className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-background/90 border border-border text-muted-foreground hover:text-foreground shadow-sm opacity-0 group-hover/card:opacity-100 focus:opacity-100 transition"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>

              {menuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-9 right-0 z-30 w-40 rounded-md border border-border bg-background shadow-lg py-1 animate-in fade-in zoom-in-95 duration-100"
                >
            {onValidate && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onValidate(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-surface text-left"
              >
                <Sparkles className="h-3.5 w-3.5" /> Validate
              </button>
            )}
            {onShowOnMap && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onShowOnMap(); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-surface text-left"
              >
                <Map className="h-3.5 w-3.5" /> Show on map
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onQuickView(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-surface text-left"
            >
              <Eye className="h-3.5 w-3.5" /> Quick view
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
              disabled={deleting}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-surface text-left text-danger"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </button>
                </div>
              )}
            </div>
          </div>
          <div className="p-2 space-y-1">
            <p className="text-xs font-medium truncate">{captured}</p>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
              <MapPin className="h-3 w-3 shrink-0" />
              {hasGps
                ? `${photo.latitude!.toFixed(5)}, ${photo.longitude!.toFixed(5)}`
                : "no coordinates"}
            </p>
            {photo.fcp_id && (
              <p className="text-[11px] text-muted-foreground truncate" title={photo.fcp_id}>
                FCP {photo.fcp_id.slice(0, 8)}
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
