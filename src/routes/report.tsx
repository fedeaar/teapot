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
  XCircle,
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
const MAX_TABLE_ROWS = 10;

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

  const failedSegments = segmentRows.filter(
    (row) => row.status === "yellow" || row.flaggedPhotos > 0,
  );
  const missingSegments = segmentRows.filter((row) => row.status === "red");
  const actionRows = segmentRows.filter((row) => row.status !== "green").slice(0, MAX_TABLE_ROWS);
  const totalLengthM = coverage?.totals.totalM ?? 0;
  const photoSummary = summarizePhotos(photos);

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
        <Link
          to="/dashboard"
          search={{ fcp: undefined, trench: undefined, waypoint: undefined }}
          className="flex items-center gap-1.5 text-sm hover:text-primary"
        >
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
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

          <section className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-slate-600" />
              <h2 className="text-sm font-bold uppercase tracking-wide">Executive Finding</h2>
            </div>
            <p className="text-sm leading-6 text-slate-700">
              The route is currently classified as{" "}
              <strong>{coverage.totals.greenPct.toFixed(1)}% complete</strong>,{" "}
              <strong>{coverage.totals.yellowPct.toFixed(1)}% partial</strong>, and{" "}
              <strong>{coverage.totals.redPct.toFixed(1)}% missing</strong> by trench length.
              {missingSegments.length > 0
                ? ` ${missingSegments.length.toLocaleString()} trench segments require photo evidence before acceptance.`
                : " No missing-evidence segments remain in the current dataset."}
              {failedSegments.length > 0
                ? ` ${failedSegments.length.toLocaleString()} segment(s) have poor-quality or failed evidence that should be retaken.`
                : " No poor-quality photo segments are currently identified."}
            </p>
          </section>

          <section className="grid lg:grid-cols-2 gap-5">
            <DeficiencyTable
              title="Failed / Poor-Quality Segments"
              empty="No poor-quality segments detected yet. Current unverified work is listed under missing evidence."
              rows={failedSegments.slice(0, MAX_TABLE_ROWS)}
              icon={<AlertTriangle className="w-4 h-4 text-amber-600" />}
            />
            <DeficiencyTable
              title="Missing Evidence"
              empty="No missing-evidence segments detected."
              rows={missingSegments.slice(0, MAX_TABLE_ROWS)}
              icon={<XCircle className="w-4 h-4 text-red-600" />}
            />
          </section>

          <section className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              <h2 className="text-sm font-bold uppercase tracking-wide">Contractor Action List</h2>
            </div>
            {actionRows.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No contractor actions remain open.</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">Priority</th>
                    <th className="text-left font-semibold px-3 py-2">FCP / Segment</th>
                    <th className="text-left font-semibold px-3 py-2">Issue</th>
                    <th className="text-left font-semibold px-3 py-2">
                      Required contractor action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {actionRows.map((row, index) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 font-semibold">
                        {row.status === "red" ? `P${index + 1}` : "Retake"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">{row.fcpId}</div>
                        <div className="font-mono text-[10px] text-slate-500 truncate max-w-[180px]">
                          {row.label}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={row.status} label={row.classification} />
                        <div className="text-[10px] text-slate-500 mt-1">
                          {row.missingWaypoints} missing wp · {row.flaggedPhotos} flagged photo(s)
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="grid sm:grid-cols-3 gap-3 border-t border-slate-200 pt-5">
            <ReportStat
              label="Accepted photos"
              value={photoSummary.compliant.toString()}
              color="#16a34a"
            />
            <ReportStat
              label="Flagged photos"
              value={photoSummary.flagged.toString()}
              color="#dc2626"
            />
            <ReportStat
              label="Pending AI review"
              value={photoSummary.pending.toString()}
              color="#d97706"
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

function summarizePhotos(photos: ReportPhoto[]) {
  return {
    compliant: photos.filter((photo) => photo.status === "compliant").length,
    flagged: photos.filter((photo) => photo.status === "flagged").length,
    pending: photos.filter((photo) => photo.status === "pending").length,
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

function DeficiencyTable({
  title,
  empty,
  rows,
  icon,
}: {
  title: string;
  empty: string;
  rows: SegmentRow[];
  icon: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <div className="p-4 text-sm text-slate-500">{empty}</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((row) => (
            <div key={row.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{row.label}</div>
                  <div className="text-[10px] font-mono text-slate-500 truncate">{row.id}</div>
                </div>
                <StatusBadge status={row.status} label={row.classification} />
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 text-[10px] text-slate-600">
                <span>FCP {row.fcpId}</span>
                <span>{row.lengthM.toFixed(0)} m</span>
                <span>
                  {row.coveredWaypoints}/{row.totalWaypoints} wp
                </span>
              </div>
              {row.issues.length > 0 && (
                <div className="text-[10px] text-slate-500 mt-2">
                  Issues: {row.issues.join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
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
