import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  MapPinned,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  computeCoverage,
  statusColor,
  type CoverageResult,
  type PhotoLite,
  type TrenchStatus,
} from "@/lib/coverage";
import { pointsAlongTrench, trenchLength } from "@/lib/geo";
import { loadProjectData, type ProjectData, type ProjectTrench } from "@/lib/project-data";
import { loadSiteData } from "@/lib/site-data";
import { siteDataToProjectData } from "@/lib/site-adapter";
import { friendlyIssueLabel } from "@/lib/issue-labels";
import { METERS_PER_PHOTO } from "@/lib/validate-photo.functions";

export const Route = createFileRoute("/report")({
  validateSearch: (raw: Record<string, unknown>) => ({
    project: typeof raw.project === "string" ? raw.project : undefined,
  }),
  head: () => ({
    meta: [
      { title: "öGIG Review Report — TeaPot" },
      {
        name: "description",
        content: "Contractor-ready fiber trench deficiency report with map and evidence gaps.",
      },
    ],
  }),
  component: ReportPage,
});

type ReportPhoto = PhotoLite & {
  id: string;
  image_url: string;
  captured_at: string;
  trench_id: string | null;
  waypoint_index: number | null;
  project_id: string | null;
  verdict: string | null;
  issues: string[] | null;
  failed_checks: string[] | null;
  recommendation: string | null;
  compliance_score: number | null;
};

type SegmentStatus = "OK" | "Poor Quality" | "Missing Evidence";

type SegmentRow = {
  id: string;
  label: string;
  fcpId: string;
  status: TrenchStatus;
  classification: SegmentStatus;
  lengthM: number;
  totalWaypoints: number;
  coveredWaypoints: number;
  missingWaypoints: number;
  flaggedPhotos: number;
  issues: string[];
  action: string;
};

const PROJECT_NAME = "CLP20417A · Maria Rain fiber route";
const LOT_ID = "Demo lot · GIS bundle public/site";
type ZoneSummaryRow = {
  fcpId: string;
  label: string;
  status: TrenchStatus;
  lengthM: number;
  trenchCount: number;
  greenTrenches: number;
  yellowTrenches: number;
  redTrenches: number;
  photoCount: number;
  compliantPhotos: number;
  needsReviewPhotos: number;
  nonCompliantPhotos: number;
  pendingPhotos: number;
  greenPct: number;
  yellowPct: number;
  redPct: number;
  topIssues: { issue: string; count: number }[];
};

type IssueAggregate = { issue: string; count: number; severity: "error" | "warning" | "info" };

function ReportPage() {
  const { project } = Route.useSearch();
  const [site, setSite] = useState<ProjectData | null>(null);
  const [photos, setPhotos] = useState<ReportPhoto[]>([]);
  const [projectName, setProjectName] = useState(PROJECT_NAME);
  const [lotId, setLotId] = useState(LOT_ID);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [generatedAt] = useState(() => new Date());
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setLoadWarning(null);
      try {
        const loadedSite = project
          ? await loadProjectData(project)
          : siteDataToProjectData(await loadSiteData());
        setSite(loadedSite);

        if (project) {
          const { data: projectRow } = await supabase
            .from("projects")
            .select("id,name,description")
            .eq("id", project)
            .maybeSingle();
          setProjectName(projectRow?.name ?? `Project ${project.slice(0, 8)}`);
          setLotId(projectRow?.description || `Project ID ${project.slice(0, 8)}`);
        } else {
          setProjectName(PROJECT_NAME);
          setLotId(LOT_ID);
        }

        try {
          let query = supabase
            .from("images")
            .select(
              "id,image_url,captured_at,fcp_id,status,verdict,trench_id,waypoint_index,project_id,issues,failed_checks,recommendation,compliance_score",
            )
            .order("captured_at", { ascending: false });

          query = project ? query.eq("project_id", project) : query.is("project_id", null);
          const { data, error } = await query;

          if (error) throw error;
          setPhotos((data as ReportPhoto[]) ?? []);
        } catch (error) {
          setLoadWarning(
            `Photo evidence could not be loaded. Showing route geometry and missing-evidence gaps only. ${error instanceof Error ? error.message : ""}`,
          );
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [project]);

  const coverage = useMemo<CoverageResult | null>(
    () => (site ? computeCoverage(site, photos) : null),
    [site, photos],
  );

  const segmentRows = useMemo(
    () => (site && coverage ? buildSegmentRows(site, coverage, photos) : []),
    [site, coverage, photos],
  );

  const compliantSegments = segmentRows.filter((row) => row.status === "green");
  const failedSegments = segmentRows.filter(
    (row) => row.status === "yellow" || (row.status !== "green" && row.flaggedPhotos > 0),
  );
  const missingSegments = segmentRows.filter((row) => row.status === "red");
  const totalLengthM = coverage?.totals.totalM ?? 0;
  const photoSummary = summarizePhotos(photos);
  const zoneSummary = useMemo(
    () => (site && coverage ? buildZoneSummary(site, coverage, photos) : []),
    [site, coverage, photos],
  );
  const greenZones = zoneSummary.filter((z) => z.status === "green").length;
  const yellowZones = zoneSummary.filter((z) => z.status === "yellow").length;
  const redZones = zoneSummary.filter((z) => z.status === "red").length;
  const issueRanking = useMemo(() => aggregateIssues(photos).slice(0, 10), [photos]);
  const photoDateRange = useMemo(() => {
    let min: string | null = null;
    let max: string | null = null;
    for (const p of photos) {
      if (!p.captured_at) continue;
      if (!min || p.captured_at < min) min = p.captured_at;
      if (!max || p.captured_at > max) max = p.captured_at;
    }
    return { min, max };
  }, [photos]);

  async function exportPdf() {
    if (!reportRef.current || !site) return;
    setExporting(true);
    try {
      // html2canvas-pro is the maintained fork that supports oklch / color-mix —
      // the original html2canvas chokes on Tailwind v4's CSS variables.
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas-pro"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
      });
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "px", format: [canvas.width, canvas.height] });
      pdf.addImage(img, "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save(`oegig-review-report-${Date.now()}.pdf`);
    } catch (e) {
      console.error("[report] exportPdf failed:", e);
      window.alert(
        `PDF export failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setExporting(false);
    }
  }

  if (loading || !site || !coverage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between sticky top-0 bg-background z-20">
        <a
          href={project ? `/project/${project}` : "/projects"}
          className="flex items-center gap-1.5 text-sm hover:text-primary"
        >
          <ArrowLeft className="w-4 h-4" /> {project ? "Project map" : "Projects"}
        </a>
        <div className="flex items-center gap-2">
          <Link
            to="/import"
            search={{ project }}
            className="hidden sm:inline-flex text-xs px-3 py-1.5 rounded-md border border-border hover:bg-surface"
          >
            Add evidence
          </Link>
          <Button onClick={exportPdf} disabled={exporting} size="sm">
            {exporting ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            PDF
          </Button>
        </div>
      </header>

      <div className="p-3 sm:p-6">
        <div
          ref={reportRef}
          className="bg-white text-slate-950 p-5 sm:p-8 rounded-md max-w-5xl mx-auto space-y-6 shadow-2xl"
        >
          <section className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                TeaPot · öGIG AI Quality Control
              </div>
              <h1 className="text-3xl font-bold tracking-tight mt-2">Review Deficiency Report</h1>
              <p className="text-sm text-slate-600 mt-2 max-w-2xl">
                Contractor-facing audit of geo-referenced trench photo evidence against the current
                fiber route geometry.
              </p>
            </div>
            <div className="text-xs text-slate-600 sm:text-right space-y-1">
              <div>
                <span className="font-semibold text-slate-900">Project:</span> {projectName}
              </div>
              <div>
                <span className="font-semibold text-slate-900">Lot:</span> {lotId}
              </div>
              <div>
                <span className="font-semibold text-slate-900">Generated:</span>{" "}
                {generatedAt.toLocaleString()}
              </div>
              {(photoDateRange.min || photoDateRange.max) && (
                <div>
                  <span className="font-semibold text-slate-900">Evidence dated:</span>{" "}
                  {photoDateRange.min
                    ? new Date(photoDateRange.min).toLocaleDateString()
                    : "—"}
                  {" → "}
                  {photoDateRange.max
                    ? new Date(photoDateRange.max).toLocaleDateString()
                    : "—"}
                </div>
              )}
            </div>
          </section>

          {loadWarning && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              {loadWarning}
            </div>
          )}

          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <ReportStat label="Route length" value={`${(totalLengthM / 1000).toFixed(2)} km`} />
            <ReportStat label="FCP zones" value={site.fcps.length.toString()} />
            <ReportStat label="Segments" value={site.trenches.length.toLocaleString()} />
            <ReportStat label="Photo evidence" value={photos.length.toLocaleString()} />
          </section>

          <section className="grid lg:grid-cols-[1.35fr_1fr] gap-5">
            <div className="rounded-lg border border-slate-200 overflow-hidden self-start">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPinned className="w-4 h-4 text-slate-600" />
                  <h2 className="text-sm font-bold uppercase tracking-wide">
                    Network Map Snapshot
                  </h2>
                </div>
                <div className="flex items-center gap-3 text-[10px] uppercase text-slate-500">
                  <LegendItem color="#22c55e" label="Complete" />
                  <LegendItem color="#eab308" label="Partial" />
                  <LegendItem color="#ef4444" label="Missing" />
                </div>
              </div>
              <ReportMapSnapshot site={site} coverage={coverage} />
            </div>

            <div className="space-y-3">
              <StatusPanel
                tone="green"
                title="GREEN · Complete"
                pct={coverage.totals.greenPct}
                meters={coverage.totals.greenM}
                detail="All required waypoint evidence accepted."
              />
              <StatusPanel
                tone="yellow"
                title="YELLOW · Partial / poor quality"
                pct={coverage.totals.yellowPct}
                meters={coverage.totals.yellowM}
                detail="Some evidence exists but is flagged or incomplete."
              />
              <StatusPanel
                tone="red"
                title="RED · Missing evidence"
                pct={coverage.totals.redPct}
                meters={coverage.totals.redM}
                detail="No compliant evidence available for review."
              />
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-600" />
              <h2 className="text-sm font-bold uppercase tracking-wide">Executive Summary</h2>
            </div>
            <p className="text-sm leading-6 text-slate-700">
              {projectName} covers <strong>{(totalLengthM / 1000).toFixed(2)} km</strong> of fiber
              trenches across <strong>{site.fcps.length}</strong> FCP zone(s) and{" "}
              <strong>{site.trenches.length.toLocaleString()}</strong> segments. By trench length
              this is currently <strong>{coverage.totals.greenPct.toFixed(1)}% compliant</strong>,{" "}
              <strong>{coverage.totals.yellowPct.toFixed(1)}% needs review</strong>, and{" "}
              <strong>{coverage.totals.redPct.toFixed(1)}% non-compliant or undocumented</strong>.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-md bg-slate-50 border border-slate-200 p-3 space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  Zone health
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="text-emerald-700 font-bold">{greenZones} compliant</span>
                  <span className="text-amber-700 font-bold">{yellowZones} review</span>
                  <span className="text-red-700 font-bold">{redZones} non-compliant</span>
                </div>
                <div className="text-slate-600">
                  {greenZones} of {zoneSummary.length} zones are fully covered by accepted evidence.
                </div>
              </div>
              <div className="rounded-md bg-slate-50 border border-slate-200 p-3 space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  Segment health
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="text-emerald-700 font-bold">{compliantSegments.length} ok</span>
                  <span className="text-amber-700 font-bold">{failedSegments.length} review</span>
                  <span className="text-red-700 font-bold">{missingSegments.length} missing</span>
                </div>
                <div className="text-slate-600">
                  {photos.length.toLocaleString()} photos analyzed —{" "}
                  {photoSummary.compliant} compliant, {photoSummary.needsReview} needs review,{" "}
                  {photoSummary.nonCompliant} non-compliant.
                </div>
              </div>
            </div>
            <p className="text-sm leading-6 text-slate-700">
              {missingSegments.length > 0
                ? `${missingSegments.length.toLocaleString()} segment(s) still require photo evidence before acceptance.`
                : "No missing-evidence segments remain in the current dataset."}{" "}
              {failedSegments.length > 0
                ? `${failedSegments.length.toLocaleString()} segment(s) have poor-quality or flagged evidence that should be retaken.`
                : "No poor-quality photo segments are currently identified."}{" "}
              {compliantSegments.length > 0 &&
                `${compliantSegments.length.toLocaleString()} segment(s) are already fully accepted and need no further action.`}
            </p>
          </section>

          <ZoneBreakdownTable rows={zoneSummary} />

          {issueRanking.length > 0 && <TopIssuesTable rows={issueRanking} />}

          <ZoneActionSummary rows={zoneSummary} />

          <CompliantZonesTable rows={zoneSummary.filter((z) => z.status === "green")} />

          <section className="grid sm:grid-cols-4 gap-3 border-t border-slate-200 pt-5">
            <ReportStat
              label="Compliant photos"
              value={photoSummary.compliant.toString()}
              color="#16a34a"
            />
            <ReportStat
              label="Needs review"
              value={photoSummary.needsReview.toString()}
              color="#d97706"
            />
            <ReportStat
              label="Non-compliant"
              value={photoSummary.nonCompliant.toString()}
              color="#dc2626"
            />
            <ReportStat
              label="Pending AI review"
              value={photoSummary.pending.toString()}
              color="#475569"
            />
          </section>
        </div>
      </div>
    </div>
  );
}

function buildSegmentRows(
  site: ProjectData,
  coverage: CoverageResult,
  photos: ReportPhoto[],
): SegmentRow[] {
  const trenchToFcp = new Map<string, string>();
  const fcpLabelById = new Map(site.fcps.map((fcp) => [fcp.id, fcp.name || fcp.id]));
  for (const [fcpId, trenches] of Object.entries(site.trenchesByFcp)) {
    for (const trench of trenches) trenchToFcp.set(trench.id, fcpLabelById.get(fcpId) ?? fcpId);
  }

  const photosByTrench = new Map<string, ReportPhoto[]>();
  for (const photo of photos) {
    if (!photo.trench_id) continue;
    const list = photosByTrench.get(photo.trench_id) ?? [];
    list.push(photo);
    photosByTrench.set(photo.trench_id, list);
  }

  return site.trenches
    .map((trench) => {
      const status = coverage.trenchStatus[trench.id] ?? "red";
      const classification = segmentClassification(status);
      const trenchPhotos = photosByTrench.get(trench.id) ?? [];
      const stats = coverage.trenchStats[trench.id];
      const coordsLngLat = projectCoordsLngLat(trench.geometry);
      const flaggedPhotos =
        stats?.flagged ??
        trenchPhotos.filter(
          (photo) => photo.status === "flagged" || photo.verdict === "non_compliant",
        ).length;
      const totalWaypoints =
        stats?.needed ?? Math.max(1, pointsAlongTrench(coordsLngLat, 5).length);
      const coveredWaypoints = stats?.compliant ?? 0;
      const missingWaypoints = Math.max(0, totalWaypoints - coveredWaypoints);
      const issues = normalizeIssues(trenchPhotos);

      return {
        id: trench.id,
        label: trench.name || trench.externalId || trench.id,
        fcpId: trenchToFcp.get(trench.id) ?? "Unassigned",
        status,
        classification,
        lengthM: trench.lengthM ?? trenchLength(coordsLngLat),
        totalWaypoints,
        coveredWaypoints,
        missingWaypoints,
        flaggedPhotos,
        issues,
        action: actionForSegment(status, missingWaypoints, flaggedPhotos),
      };
    })
    .sort((a, b) => {
      const rank = { red: 0, yellow: 1, green: 2 };
      return (
        rank[a.status] - rank[b.status] ||
        b.flaggedPhotos - a.flaggedPhotos ||
        b.lengthM - a.lengthM
      );
    });
}

function projectCoordsLngLat(coords: [number, number][]): [number, number][] {
  return coords.map(([lat, lng]) => [lng, lat]);
}

function normalizeIssues(photos: ReportPhoto[]): string[] {
  const raw = new Set<string>();
  for (const photo of photos) {
    for (const issue of photo.issues ?? []) raw.add(issue);
    for (const issue of photo.failed_checks ?? []) raw.add(issue);
  }
  return Array.from(raw).slice(0, 4);
}

function actionForSegment(
  status: TrenchStatus,
  missingWaypoints: number,
  flaggedPhotos: number,
): string {
  if (status === "green") return "Archive evidence. No contractor rework required.";
  if (status === "yellow") {
    return `Retake ${Math.max(1, flaggedPhotos)} flagged photo(s), fill ${missingWaypoints} missing 5 m waypoint(s), and show ruler, bedding, side profile and warning tape clearly.`;
  }
  return `Submit GPS-tagged evidence for ${missingWaypoints} missing 5 m waypoint(s), then retake any photo without visible depth reference, bedding, side profile or warning tape.`;
}

function segmentClassification(status: TrenchStatus): SegmentStatus {
  if (status === "green") return "OK";
  if (status === "yellow") return "Poor Quality";
  return "Missing Evidence";
}

// Per-FCP breakdown: rolls up trench statuses, photo class counts, and the
// top 3 friendly issues mentioned by photos inside the zone. Length comes
// straight from the geometry so the numbers tie back to the map snapshot.
function buildZoneSummary(
  site: ProjectData,
  coverage: CoverageResult,
  photos: ReportPhoto[],
): ZoneSummaryRow[] {
  const rows: ZoneSummaryRow[] = [];
  for (const fcp of site.fcps) {
    const trenches = site.trenchesByFcp[fcp.id] ?? [];
    const trenchIds = new Set(trenches.map((t) => t.id));
    let greenTrenches = 0;
    let yellowTrenches = 0;
    let redTrenches = 0;
    let lengthM = 0;
    for (const t of trenches) {
      const status = coverage.trenchStatus[t.id] ?? "red";
      if (status === "green") greenTrenches++;
      else if (status === "yellow") yellowTrenches++;
      else redTrenches++;
      lengthM +=
        t.lengthM ?? trenchLength(projectCoordsLngLat(t.geometry));
    }

    let compliantPhotos = 0;
    let needsReviewPhotos = 0;
    let nonCompliantPhotos = 0;
    let pendingPhotos = 0;
    let photoCount = 0;
    const issueCounter = new Map<string, number>();
    for (const photo of photos) {
      if (photo.fcp_id !== fcp.id && !(photo.trench_id && trenchIds.has(photo.trench_id)))
        continue;
      photoCount++;
      const verdict = photo.verdict;
      if (verdict === "compliant") compliantPhotos++;
      else if (verdict === "needs_review") needsReviewPhotos++;
      else if (verdict === "non_compliant") nonCompliantPhotos++;
      else if (photo.status === "pending") pendingPhotos++;
      for (const raw of [...(photo.failed_checks ?? []), ...(photo.issues ?? [])]) {
        const f = friendlyIssueLabel(raw);
        if (!f) continue;
        issueCounter.set(f.label, (issueCounter.get(f.label) ?? 0) + 1);
      }
    }

    const photoGreenM = compliantPhotos * METERS_PER_PHOTO;
    const photoYellowM = needsReviewPhotos * METERS_PER_PHOTO;
    const denom = Math.max(lengthM, photoGreenM + photoYellowM, 1);
    const greenM = Math.min(photoGreenM, denom);
    const yellowM = Math.min(photoYellowM, denom - greenM);
    const redM = Math.max(0, denom - greenM - yellowM);

    const topIssues = Array.from(issueCounter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([issue, count]) => ({ issue, count }));

    rows.push({
      fcpId: fcp.id,
      label: fcp.name || fcp.id.slice(0, 8),
      status: coverage.zoneStatus[fcp.id] ?? "red",
      lengthM,
      trenchCount: trenches.length,
      greenTrenches,
      yellowTrenches,
      redTrenches,
      photoCount,
      compliantPhotos,
      needsReviewPhotos,
      nonCompliantPhotos,
      pendingPhotos,
      greenPct: (greenM / denom) * 100,
      yellowPct: (yellowM / denom) * 100,
      redPct: (redM / denom) * 100,
      topIssues,
    });
  }
  return rows.sort((a, b) => {
    const rank = { red: 0, yellow: 1, green: 2 };
    return rank[a.status] - rank[b.status] || b.lengthM - a.lengthM;
  });
}

// Aggregate friendly issue labels across all photos. Used to surface
// systemic problems (e.g. "Trench was not photographed from the side: 42").
function aggregateIssues(photos: ReportPhoto[]): IssueAggregate[] {
  const counts = new Map<string, { count: number; severity: "error" | "warning" | "info" }>();
  for (const photo of photos) {
    const seen = new Set<string>();
    for (const raw of [...(photo.failed_checks ?? []), ...(photo.issues ?? [])]) {
      const f = friendlyIssueLabel(raw);
      if (!f) continue;
      if (seen.has(f.label)) continue;
      seen.add(f.label);
      const existing = counts.get(f.label);
      counts.set(f.label, {
        count: (existing?.count ?? 0) + 1,
        severity: existing?.severity ?? f.severity,
      });
    }
  }
  return Array.from(counts.entries())
    .map(([issue, { count, severity }]) => ({ issue, count, severity }))
    .sort((a, b) => b.count - a.count);
}

function summarizePhotos(photos: ReportPhoto[]) {
  return {
    compliant: photos.filter((p) => p.verdict === "compliant").length,
    needsReview: photos.filter((p) => p.verdict === "needs_review").length,
    nonCompliant: photos.filter((p) => p.verdict === "non_compliant").length,
    flagged: photos.filter((p) => p.status === "flagged").length,
    pending: photos.filter((p) => p.status === "pending").length,
  };
}

function ReportMapSnapshot({ site, coverage }: { site: ProjectData; coverage: CoverageResult }) {
  const width = 920;
  const height = 360;
  const padding = 18;
  const bounds = getBounds(
    site.clusters.some((cluster) => cluster.geometry?.length)
      ? site.clusters.flatMap((cluster) => cluster.geometry ?? [])
      : site.trenches.flatMap((trench) => trench.geometry),
  );

  const projectPoint = ([lat, lng]: [number, number]) => {
    const x =
      padding +
      ((lng - bounds.minLng) / Math.max(0.000001, bounds.maxLng - bounds.minLng)) *
        (width - padding * 2);
    const y =
      height -
      padding -
      ((lat - bounds.minLat) / Math.max(0.000001, bounds.maxLat - bounds.minLat)) *
        (height - padding * 2);
    return [x, y] as const;
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto bg-slate-950">
      {site.clusters.map((cluster) =>
        cluster.geometry ? (
          <polygon
            key={cluster.id}
            points={cluster.geometry.map((point) => projectPoint(point).join(",")).join(" ")}
            fill="#1e293b"
            stroke="#64748b"
            strokeWidth="1"
            opacity="0.7"
          />
        ) : null,
      )}
      {site.trenches.map((trench) => (
        <polyline
          key={trench.id}
          points={trench.geometry.map((point) => projectPoint(point).join(",")).join(" ")}
          fill="none"
          stroke={statusColor(coverage.trenchStatus[trench.id] ?? "red")}
          strokeWidth={lineWidth(trench)}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.85"
        />
      ))}
      {site.fcps.map((fcp) => {
        if (fcp.lat == null || fcp.lng == null) return null;
        const [x, y] = projectPoint([fcp.lat, fcp.lng]);
        const status = coverage.zoneStatus[fcp.id] ?? "red";
        return (
          <g key={fcp.id}>
            <circle
              cx={x}
              cy={y}
              r="6"
              fill={statusColor(status)}
              stroke="#ffffff"
              strokeWidth="2"
            />
            <text
              x={x + 8}
              y={y - 8}
              fill="#ffffff"
              fontSize="10"
              fontFamily="Inter, system-ui, sans-serif"
              fontWeight="700"
            >
              {fcp.name || fcp.id.slice(0, 8)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function getBounds(coords: [number, number][]) {
  if (coords.length === 0) {
    return { minLng: 0, maxLng: 1, minLat: 0, maxLat: 1 };
  }
  return coords.reduce(
    (acc, [lat, lng]) => ({
      minLng: Math.min(acc.minLng, lng),
      maxLng: Math.max(acc.maxLng, lng),
      minLat: Math.min(acc.minLat, lat),
      maxLat: Math.max(acc.maxLat, lat),
    }),
    { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity },
  );
}

function lineWidth(trench: ProjectTrench): string {
  return (trench.name ?? "").includes("Hausanschluss") ? "1.4" : "2.2";
}

function ReportStat({
  label,
  value,
  color = "#0f172a",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-[10px] uppercase text-slate-500 tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function StatusPanel({
  tone,
  title,
  pct,
  meters,
  detail,
}: {
  tone: TrenchStatus;
  title: string;
  pct: number;
  meters: number;
  detail: string;
}) {
  const color = statusColor(tone);
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide" style={{ color }}>
            {title}
          </div>
          <p className="text-xs text-slate-500 mt-1">{detail}</p>
        </div>
        <div className="text-3xl font-bold" style={{ color }}>
          {pct.toFixed(1)}%
        </div>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden mt-3">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="text-[10px] text-slate-500 mt-1">{(meters / 1000).toFixed(2)} km</div>
    </div>
  );
}

function StatusBadge({ status, label }: { status: TrenchStatus; label: SegmentStatus }) {
  const color = statusColor(status);
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {label}
    </span>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

// Per-zone rollup table. Two views per row: the trench-status breakdown
// (good/review/missing trenches) and the photo-class breakdown so the
// reader can spot zones that are "covered but not yet accepted" vs zones
// that simply have no evidence.
function ZoneBreakdownTable({ rows }: { rows: ZoneSummaryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
        <MapPinned className="w-4 h-4 text-slate-600" />
        <h2 className="text-sm font-bold uppercase tracking-wide">Zone Breakdown</h2>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500">
          {rows.length} zone{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500 uppercase tracking-wide">
          <tr>
            <th className="text-left font-semibold px-3 py-2">Zone</th>
            <th className="text-left font-semibold px-3 py-2">Status</th>
            <th className="text-right font-semibold px-3 py-2">Length</th>
            <th className="text-right font-semibold px-3 py-2">Trenches</th>
            <th className="text-right font-semibold px-3 py-2">Photos</th>
            <th className="text-left font-semibold px-3 py-2">Coverage by length</th>
            <th className="text-left font-semibold px-3 py-2">Top issues</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.fcpId}>
              <td className="px-3 py-2">
                <div className="font-semibold text-slate-900">{row.label}</div>
                <div className="font-mono text-[10px] text-slate-500 truncate max-w-[140px]">
                  {row.fcpId}
                </div>
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={row.status} label={segmentClassification(row.status)} />
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {(row.lengthM / 1000).toFixed(2)} km
              </td>
              <td className="px-3 py-2 text-right">
                <span className="text-emerald-700 font-bold">{row.greenTrenches}</span>
                <span className="text-slate-400 mx-1">/</span>
                <span className="text-amber-700 font-bold">{row.yellowTrenches}</span>
                <span className="text-slate-400 mx-1">/</span>
                <span className="text-red-700 font-bold">{row.redTrenches}</span>
                <div className="text-[10px] text-slate-500">
                  of {row.trenchCount}
                </div>
              </td>
              <td className="px-3 py-2 text-right">
                <div className="font-mono">{row.photoCount}</div>
                <div className="text-[10px] text-slate-500">
                  {row.compliantPhotos} ok · {row.needsReviewPhotos} rev · {row.nonCompliantPhotos} fail
                </div>
              </td>
              <td className="px-3 py-2 min-w-[160px]">
                <CoverageBar
                  greenPct={row.greenPct}
                  yellowPct={row.yellowPct}
                  redPct={row.redPct}
                />
                <div className="text-[10px] text-slate-500 mt-1">
                  {row.greenPct.toFixed(0)}% / {row.yellowPct.toFixed(0)}% / {row.redPct.toFixed(0)}%
                </div>
              </td>
              <td className="px-3 py-2 text-[11px] text-slate-700 max-w-[260px]">
                {row.topIssues.length === 0 ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <ul className="space-y-0.5">
                    {row.topIssues.map((i) => (
                      <li key={i.issue} className="truncate">
                        <span className="font-mono text-slate-500">{i.count}×</span> {i.issue}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CoverageBar({
  greenPct,
  yellowPct,
  redPct,
}: {
  greenPct: number;
  yellowPct: number;
  redPct: number;
}) {
  return (
    <div className="h-2 w-full rounded-full overflow-hidden bg-slate-100 flex">
      {greenPct > 0 && <div className="h-full bg-emerald-500" style={{ width: `${greenPct}%` }} />}
      {yellowPct > 0 && <div className="h-full bg-amber-500" style={{ width: `${yellowPct}%` }} />}
      {redPct > 0 && <div className="h-full bg-red-500" style={{ width: `${redPct}%` }} />}
    </div>
  );
}

// Top friendly issues across the entire dataset, so a contractor can see
// "X% of photos miss the side view" at a glance.
function TopIssuesTable({ rows }: { rows: IssueAggregate[] }) {
  return (
    <section className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600" />
        <h2 className="text-sm font-bold uppercase tracking-wide">Most Common Issues</h2>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500">
          top {rows.length}
        </span>
      </div>
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500 uppercase tracking-wide">
          <tr>
            <th className="text-left font-semibold px-3 py-2">#</th>
            <th className="text-left font-semibold px-3 py-2">Issue</th>
            <th className="text-right font-semibold px-3 py-2">Photos affected</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, idx) => (
            <tr key={row.issue}>
              <td className="px-3 py-2 font-mono text-slate-400">{idx + 1}</td>
              <td className="px-3 py-2 text-slate-800">{row.issue}</td>
              <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                {row.count}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// Zone-level contractor action summary. One row per zone needing work, with
// rolled-up counts (how many trenches missing / under review, how many
// flagged photos, etc.) and a single guidance line — no per-trench drilldown.
function ZoneActionSummary({ rows }: { rows: ZoneSummaryRow[] }) {
  const actionable = rows
    .filter((z) => z.status !== "green")
    .sort((a, b) => {
      const rank = { red: 0, yellow: 1, green: 2 };
      return rank[a.status] - rank[b.status] || b.redTrenches - a.redTrenches;
    });
  return (
    <section className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-700" />
        <h2 className="text-sm font-bold uppercase tracking-wide">Contractor Action List</h2>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500">
          {actionable.length === 0
            ? "no actions"
            : `${actionable.length} zone${actionable.length === 1 ? "" : "s"} need work`}
        </span>
      </div>
      {actionable.length === 0 ? (
        <div className="p-4 text-sm text-slate-500">No contractor actions remain open.</div>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="text-left font-semibold px-3 py-2">Zone</th>
              <th className="text-left font-semibold px-3 py-2">Status</th>
              <th className="text-right font-semibold px-3 py-2">Trenches</th>
              <th className="text-left font-semibold px-3 py-2">Required action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {actionable.map((zone) => (
              <tr key={zone.fcpId}>
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-900">{zone.label}</div>
                  <div className="text-[10px] text-slate-500">
                    {(zone.lengthM / 1000).toFixed(2)} km · {zone.photoCount} photo(s)
                  </div>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={zone.status} label={segmentClassification(zone.status)} />
                </td>
                <td className="px-3 py-2 text-right">
                  {zone.redTrenches > 0 && (
                    <span className="text-red-700 font-bold mr-2">{zone.redTrenches} missing</span>
                  )}
                  {zone.yellowTrenches > 0 && (
                    <span className="text-amber-700 font-bold">{zone.yellowTrenches} review</span>
                  )}
                  <div className="text-[10px] text-slate-500">of {zone.trenchCount}</div>
                </td>
                <td className="px-3 py-2 text-slate-700">{zoneAction(zone)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function zoneAction(zone: ZoneSummaryRow): string {
  const parts: string[] = [];
  if (zone.redTrenches > 0)
    parts.push(
      `submit GPS-tagged evidence for ${zone.redTrenches} undocumented trench${zone.redTrenches === 1 ? "" : "es"}`,
    );
  if (zone.nonCompliantPhotos > 0)
    parts.push(
      `retake ${zone.nonCompliantPhotos} non-compliant photo${zone.nonCompliantPhotos === 1 ? "" : "s"}`,
    );
  if (zone.needsReviewPhotos > 0)
    parts.push(
      `review ${zone.needsReviewPhotos} flagged photo${zone.needsReviewPhotos === 1 ? "" : "s"}`,
    );
  if (parts.length === 0) return "Awaiting evidence.";
  // Capitalize first letter, end with full stop.
  const sentence = parts.join("; ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}

// Zone-level positive evidence. Lists only zones that already passed in full.
function CompliantZonesTable({ rows }: { rows: ZoneSummaryRow[] }) {
  return (
    <section className="rounded-lg border border-emerald-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-emerald-200 bg-emerald-50/50 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        <h2 className="text-sm font-bold uppercase tracking-wide">Compliant Zones</h2>
        {rows.length > 0 && (
          <span className="ml-auto text-[10px] uppercase tracking-wider text-emerald-700">
            {rows.length} zone{rows.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="p-4 text-sm text-slate-500">No fully compliant zones yet.</div>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="text-left font-semibold px-3 py-2">Zone</th>
              <th className="text-right font-semibold px-3 py-2">Length</th>
              <th className="text-right font-semibold px-3 py-2">Trenches</th>
              <th className="text-right font-semibold px-3 py-2">Photos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((zone) => (
              <tr key={zone.fcpId}>
                <td className="px-3 py-2 font-semibold text-slate-900">{zone.label}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {(zone.lengthM / 1000).toFixed(2)} km
                </td>
                <td className="px-3 py-2 text-right font-mono">{zone.trenchCount}</td>
                <td className="px-3 py-2 text-right font-mono">{zone.compliantPhotos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
