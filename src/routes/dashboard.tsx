import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { loadSiteData, type SiteData } from "@/lib/site-data";
import { siteDataToProjectData } from "@/lib/site-adapter";
import { computeCoverage, type CoverageResult, type PhotoLite } from "@/lib/coverage";
import { supabase } from "@/integrations/supabase/client";
import { ClientOnly } from "@tanstack/react-router";
import {
  Loader2,
  ArrowLeft,
  Activity,
  AlertTriangle,
  CheckCircle2,
  X,
  MapPin,
  Camera,
  ImageOff,
  Upload,
  KeyRound,
  FileText,
} from "lucide-react";
import { AccessCodeDialog } from "@/components/site/AccessCodeDialog";
import { trenchLength, pointsAlongTrench } from "@/lib/geo";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Coverage Dashboard — TeaPot" },
      {
        name: "description",
        content: "AI-powered coverage intelligence for the fiber-optic site.",
      },
    ],
  }),
  validateSearch: (raw: Record<string, unknown>) => ({
    fcp: typeof raw.fcp === "string" ? raw.fcp : undefined,
    trench: typeof raw.trench === "string" ? raw.trench : undefined,
    waypoint:
      typeof raw.waypoint === "number"
        ? raw.waypoint
        : typeof raw.waypoint === "string" && raw.waypoint !== ""
          ? Number(raw.waypoint)
          : undefined,
  }),
  component: DashboardPage,
});

export type MapPhoto = {
  id: string;
  latitude: number;
  longitude: number;
  status: string | null;
  verdict: string | null;
  trench_id: string | null;
  waypoint_index: number | null;
  image_url: string;
  fcp_id: string | null;
  compliance_score: number | null;
  depth_cm: number | null;
  depth_pass: boolean | null;
  visible_length_m: number | null;
  ruler_visible: boolean | null;
  bedding_visible: boolean | null;
  duct_bundle_visible: boolean | null;
  pipe_ends_visible: boolean | null;
  unobstructed: boolean | null;
  issues: string[] | null;
  recommendation: string | null;
  captured_at: string | null;
};

const CoverageMap = lazy(() =>
  import("@/components/site/CoverageMap").then((m) => ({ default: m.CoverageMap })),
);

type StatusFilter = "green" | "yellow" | "red" | null;

function DashboardPage() {
  const search = Route.useSearch();
  const [site, setSite] = useState<SiteData | null>(null);
  const [photos, setPhotos] = useState<PhotoLite[]>([]);
  const [mapPhotos, setMapPhotos] = useState<MapPhoto[]>([]);
  const [filter, setFilter] = useState<StatusFilter>(null);
  const [selectedFcpId, setSelectedFcpId] = useState<string | null>(search.fcp ?? null);
  const [selectedTrenchId, setSelectedTrenchId] = useState<string | null>(search.trench ?? null);
  const [selectedWaypointIndex, setSelectedWaypointIndex] = useState<number | null>(
    search.waypoint ?? null,
  );

  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);

  // Reset trench/waypoint selection when zone changes — but skip the first run
  // so URL search params seeded into state aren't immediately cleared.
  const didMountFcp = useRef(false);
  useEffect(() => {
    if (!didMountFcp.current) {
      didMountFcp.current = true;
      return;
    }
    setSelectedTrenchId(null);
    setSelectedWaypointIndex(null);
  }, [selectedFcpId]);

  const didMountTrench = useRef(false);
  useEffect(() => {
    if (!didMountTrench.current) {
      didMountTrench.current = true;
      return;
    }
    setSelectedWaypointIndex(null);
  }, [selectedTrenchId]);

  useEffect(() => {
    void loadSiteData().then(setSite);
  }, []);

  const loadPhotos = useCallback(async () => {
    const { data } = await supabase
      .from("images")
      .select(
        "id,fcp_id,status,verdict,latitude,longitude,trench_id,waypoint_index,image_url,compliance_score,depth_cm,depth_pass,ruler_visible,bedding_visible,duct_bundle_visible,unobstructed,issues,recommendation,captured_at",
      );
    if (!data) return;
    setPhotos(
      data.map((d) => ({
        fcp_id: d.fcp_id,
        trench_id: d.trench_id,
        waypoint_index: d.waypoint_index as number | null,
        status: d.status,
        verdict: d.verdict,
      })),
    );
    setMapPhotos(
      data
        .filter(
          (d): d is typeof d & { latitude: number; longitude: number } =>
            d.latitude != null && d.longitude != null,
        )
        .map((d) => ({
          id: d.id,
          latitude: d.latitude,
          longitude: d.longitude,
          status: d.status,
          verdict: d.verdict,
          trench_id: d.trench_id,
          waypoint_index: d.waypoint_index,
          image_url: d.image_url,
          fcp_id: d.fcp_id,
          compliance_score: d.compliance_score as number | null,
          depth_cm: d.depth_cm as number | null,
          depth_pass: d.depth_pass,
          visible_length_m: null,
          ruler_visible: d.ruler_visible,
          bedding_visible: d.bedding_visible,
          duct_bundle_visible: d.duct_bundle_visible,
          pipe_ends_visible: null,
          unobstructed: d.unobstructed,
          issues: (d.issues as string[] | null) ?? null,
          recommendation: d.recommendation,
          captured_at: d.captured_at,
        })),
    );
  }, []);

  useEffect(() => {
    void loadPhotos();
    // Live-refresh on insert/update/delete so coverage recomputes automatically.
    const channel = supabase
      .channel("dashboard-photos")
      .on("postgres_changes", { event: "*", schema: "public", table: "images" }, () => {
        void loadPhotos();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadPhotos]);

  const coverage: CoverageResult | null = useMemo(
    () => (site ? computeCoverage(site, photos) : null),
    [site, photos],
  );

  const projectData = useMemo(() => (site ? siteDataToProjectData(site) : null), [site]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between bg-surface">
        <div className="flex items-center gap-3">
          <Link to="/" className="p-1.5 rounded-md hover:bg-background">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-base font-bold tracking-tight uppercase">Coverage Intelligence</h1>
            <p className="text-[11px] text-muted-foreground">
              CLP20417A · Klagenfurt fiber-optic project
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/report"
            search={{ project: undefined }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted"
          >
            <FileText className="w-3.5 h-3.5" /> Report
          </Link>
          <Link
            to="/import"
            search={{ project: undefined }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
          >
            <Upload className="w-3.5 h-3.5" /> Import photos
          </Link>
          <AccessCodeDialog
            trigger={
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
              >
                <KeyRound className="w-3.5 h-3.5" /> Access code
              </button>
            }
          />
          <Link
            to="/"
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90"
          >
            Worker view →
          </Link>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_360px] min-h-0">
        <div className="relative min-h-[55vh] lg:min-h-0">
          <ClientOnly fallback={<MapLoading />}>
            <Suspense fallback={<MapLoading />}>
              {projectData && coverage ? (
                <CoverageMap
                  site={projectData}
                  coverage={coverage}
                  filter={filter}
                  selectedFcpId={selectedFcpId}
                  onZoneSelect={setSelectedFcpId}
                  selectedTrenchId={selectedTrenchId}
                  onTrenchSelect={setSelectedTrenchId}
                  selectedWaypointIndex={selectedWaypointIndex}
                  onWaypointSelect={setSelectedWaypointIndex}
                  photos={mapPhotos.filter(
                    (p): p is typeof p & { status: string } => p.status != null,
                  )}
                  onPhotoClick={setSelectedPhotoId}
                />
              ) : (
                <MapLoading />
              )}
            </Suspense>
          </ClientOnly>
          {selectedPhotoId && (
            <PhotoDetailPanel
              photo={mapPhotos.find((p) => p.id === selectedPhotoId) ?? null}
              onClose={() => setSelectedPhotoId(null)}
            />
          )}
        </div>

        <aside className="border-t lg:border-t-0 lg:border-l border-border overflow-y-auto bg-surface">
          {coverage && site ? (
            selectedFcpId ? (
              <ZoneDetail
                site={site}
                coverage={coverage}
                fcpId={selectedFcpId}
                selectedTrenchId={selectedTrenchId}
                onTrenchSelect={setSelectedTrenchId}
                selectedWaypointIndex={selectedWaypointIndex}
                onWaypointSelect={setSelectedWaypointIndex}
                onClose={() => setSelectedFcpId(null)}
              />
            ) : (
              <Sidebar
                coverage={coverage}
                site={site}
                filter={filter}
                onFilterChange={setFilter}
                onZoneSelect={setSelectedFcpId}
              />
            )
          ) : (
            <MapLoading />
          )}
        </aside>
      </div>
    </div>
  );
}

function Sidebar({
  coverage,
  site,
  filter,
  onFilterChange,
  onZoneSelect,
}: {
  coverage: CoverageResult;
  site: SiteData;
  filter: StatusFilter;
  onFilterChange: (f: StatusFilter) => void;
  onZoneSelect: (fcpId: string) => void;
}) {
  const t = coverage.totals;
  const toggle = (tone: "green" | "yellow" | "red") =>
    onFilterChange(filter === tone ? null : tone);
  return (
    <div className="p-4 space-y-4">
      {filter && (
        <button
          onClick={() => onFilterChange(null)}
          className="w-full text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground py-1.5 rounded-md border border-border bg-background"
        >
          Showing {filter.toUpperCase()} only · clear filter
        </button>
      )}
      <StatusCard
        tone="green"
        title="GREEN — Complete"
        icon={<CheckCircle2 className="w-4 h-4" />}
        body="Photo every 5m + GPS verified."
        pct={t.greenPct}
        meters={t.greenM}
        active={filter === "green"}
        dimmed={filter !== null && filter !== "green"}
        onClick={() => toggle("green")}
      />
      <StatusCard
        tone="yellow"
        title="YELLOW — Partial"
        icon={<Activity className="w-4 h-4" />}
        body="Photos present but quality insufficient."
        pct={t.yellowPct}
        meters={t.yellowM}
        active={filter === "yellow"}
        dimmed={filter !== null && filter !== "yellow"}
        onClick={() => toggle("yellow")}
      />
      <StatusCard
        tone="red"
        title="RED — Missing"
        icon={<AlertTriangle className="w-4 h-4" />}
        body="No compliant survey or photos. Highest risk."
        pct={t.redPct}
        meters={t.redM}
        active={filter === "red"}
        dimmed={filter !== null && filter !== "red"}
        onClick={() => toggle("red")}
      />

      <div className="rounded-xl bg-background border border-border p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          Documentation status (by trench length)
        </div>
        <BarRow label="GREEN" pct={t.greenPct} color="bg-success" />
        <BarRow label="YELLOW" pct={t.yellowPct} color="bg-warning" />
        <BarRow label="RED" pct={t.redPct} color="bg-danger" />
        <div className="text-[10px] text-muted-foreground mt-2">
          {(t.totalM / 1000).toFixed(2)} km of trenches monitored
        </div>
      </div>

      <div className="rounded-xl bg-background border border-border p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
          FCP zones ({site.fcps.length})
        </div>
        <div className="space-y-1.5">
          {site.fcps.map((f) => {
            const s = coverage.zoneStatus[f.id] ?? "red";
            const stats = coverage.zoneStats[f.id];
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onZoneSelect(f.id)}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-surface text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      background:
                        s === "green" ? "#22c55e" : s === "yellow" ? "#eab308" : "#ef4444",
                    }}
                  />
                  <span className="text-xs font-semibold">{f.id}</span>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {f.address ?? ""}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                  {stats ? `${stats.compliant}/${stats.needed}` : "—"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl bg-primary/10 border border-primary/30 p-3 text-xs">
        <div className="font-semibold mb-1">AI auto-classifies every trench segment</div>
        <p className="text-muted-foreground">
          Each photo from the field is geo-checked, validated by AI, and rolled up into the
          live coverage map you see here.
        </p>
      </div>
    </div>
  );
}

function StatusCard({
  tone,
  title,
  icon,
  body,
  pct,
  meters,
  active,
  dimmed,
  onClick,
}: {
  tone: "green" | "yellow" | "red";
  title: string;
  icon: React.ReactNode;
  body: string;
  pct: number;
  meters: number;
  active?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
}) {
  const ring =
    tone === "green"
      ? "border-success/60 bg-success/10"
      : tone === "yellow"
        ? "border-warning/60 bg-warning/10"
        : "border-danger/60 bg-danger/10";
  const text =
    tone === "green" ? "text-success" : tone === "yellow" ? "text-warning" : "text-danger";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border-2 ${ring} p-3 transition-all cursor-pointer hover:scale-[1.01] ${
        active ? "ring-2 ring-offset-2 ring-offset-surface ring-current" : ""
      } ${dimmed ? "opacity-50" : ""}`}
    >
      <div className={`flex items-center gap-2 ${text} font-bold text-sm`}>
        {icon}
        {title}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{body}</p>
      <div className="flex items-baseline justify-between mt-2">
        <span className={`text-2xl font-bold ${text}`}>{pct.toFixed(1)}%</span>
        <span className="text-[11px] text-muted-foreground font-mono">
          {(meters / 1000).toFixed(2)} km
        </span>
      </div>
    </button>
  );
}

function BarRow({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <span className="text-[10px] w-14 text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-surface overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] w-10 text-right font-mono">{pct.toFixed(0)}%</span>
    </div>
  );
}

type ZonePhoto = {
  id: string;
  image_url: string;
  status: string;
  trench_id: string | null;
  captured_at: string;
  compliance_score: number | null;
};

function ZoneDetail({
  site,
  coverage,
  fcpId,
  selectedTrenchId,
  onTrenchSelect,
  selectedWaypointIndex,
  onWaypointSelect,
  onClose,
}: {
  site: SiteData;
  coverage: CoverageResult;
  fcpId: string;
  selectedTrenchId: string | null;
  onTrenchSelect: (id: string | null) => void;
  selectedWaypointIndex: number | null;
  onWaypointSelect: (i: number | null) => void;
  onClose: () => void;
}) {
  const selectedTrench = selectedTrenchId
    ? site.trenches.find((t) => t.id === selectedTrenchId)
    : null;
  const waypoints = useMemo(
    () => (selectedTrench ? pointsAlongTrench(selectedTrench.coords, 5) : []),
    [selectedTrench],
  );
  const [zonePhotos, setZonePhotos] = useState<ZonePhoto[]>([]);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("images")
        .select("id,image_url,status,trench_id,captured_at,compliance_score")
        .eq("fcp_id", fcpId)
        .order("captured_at", { ascending: false });
      setZonePhotos((data as ZonePhoto[]) ?? []);
    })();
  }, [fcpId]);
  const fcp = site.fcps.find((f) => f.id === fcpId);
  const stats = coverage.zoneStats[fcpId];
  const status = coverage.zoneStatus[fcpId] ?? "red";
  const trenches = site.trenchesByFcp[fcpId] ?? [];
  const totalM = trenches.reduce((s, t) => s + trenchLength(t.coords), 0);
  const ratio = stats ? Math.min(1, stats.ratio) : 0;
  const tone =
    status === "green"
      ? {
          text: "text-success",
          bg: "bg-success/10",
          border: "border-success/60",
          bar: "bg-success",
        }
      : status === "yellow"
        ? {
            text: "text-warning",
            bg: "bg-warning/10",
            border: "border-warning/60",
            bar: "bg-warning",
          }
        : { text: "text-danger", bg: "bg-danger/10", border: "border-danger/60", bar: "bg-danger" };

  return (
    <div className="p-4 space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Zone</div>
          <h2 className="text-xl font-bold tracking-tight">{fcpId}</h2>
          {fcp?.address && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3" /> {fcp.address}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-background border border-border"
          aria-label="Close zone detail"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className={`rounded-xl border-2 ${tone.border} ${tone.bg} p-3`}>
        <div className={`text-xs font-bold uppercase ${tone.text}`}>{status} status</div>
        <div className="flex items-baseline justify-between mt-2">
          <span className={`text-3xl font-bold ${tone.text}`}>{(ratio * 100).toFixed(0)}%</span>
          <span className="text-[11px] text-muted-foreground font-mono">
            {stats ? `${stats.compliant}/${stats.needed} photos` : "—"}
          </span>
        </div>
        <div className="h-2 mt-2 rounded-full bg-background overflow-hidden">
          <div
            className={`h-full ${tone.bar} transition-all duration-500`}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Trenches" value={trenches.length.toString()} />
        <Stat label="Length" value={`${(totalM / 1000).toFixed(2)} km`} />
        <Stat label="Flagged" value={(stats?.flagged ?? 0).toString()} />
      </div>

      <div className="rounded-xl bg-background border border-border p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center justify-between">
          <span>Trenches in zone</span>
          {selectedTrenchId && (
            <button
              onClick={() => onTrenchSelect(null)}
              className="text-[10px] text-primary hover:underline"
            >
              clear
            </button>
          )}
        </div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {trenches.length === 0 && (
            <div className="text-xs text-muted-foreground">No trenches assigned to this zone.</div>
          )}
          {trenches.map((t) => {
            const ts = coverage.trenchStatus[t.id] ?? "red";
            const c = ts === "green" ? "#22c55e" : ts === "yellow" ? "#eab308" : "#ef4444";
            const isSel = selectedTrenchId === t.id;
            const len = trenchLength(t.coords);
            const points = Math.max(1, Math.ceil(len / 5));
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onTrenchSelect(isSel ? null : t.id)}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                  isSel ? "bg-primary/15 ring-1 ring-primary/40" : "hover:bg-surface"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c }} />
                  <span className="text-xs font-mono truncate">{t.label || t.id}</span>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                  {len.toFixed(0)}m · {points}pt
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedTrench && waypoints.length > 0 && (
        <div className="rounded-xl bg-background border border-border p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center justify-between">
            <span>5m waypoints · {selectedTrench.label || selectedTrench.id}</span>
            <span className="font-mono normal-case tracking-normal">{waypoints.length}</span>
          </div>
          <div className="grid grid-cols-5 gap-1 max-h-40 overflow-y-auto">
            {waypoints.map((_, idx) => {
              const isSel = selectedWaypointIndex === idx;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onWaypointSelect(isSel ? null : idx)}
                  className={`text-[10px] font-mono px-1.5 py-1 rounded-md border transition-colors ${
                    isSel
                      ? "bg-amber-400 text-black border-amber-400"
                      : "bg-surface border-border hover:border-primary/60"
                  }`}
                  title={`Waypoint ${idx + 1} · ${idx * 5}m`}
                >
                  {idx * 5}m
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl bg-background border border-border p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Camera className="w-3 h-3" /> Photos uploaded
            {selectedTrenchId && (
              <span className="text-primary normal-case tracking-normal">
                · trench {selectedTrenchId}
              </span>
            )}
          </span>
          <span className="font-mono normal-case tracking-normal">
            {
              (selectedTrenchId
                ? zonePhotos.filter((p) => p.trench_id === selectedTrenchId)
                : zonePhotos
              ).length
            }
          </span>
        </div>
        {(() => {
          const list = selectedTrenchId
            ? zonePhotos.filter((p) => p.trench_id === selectedTrenchId)
            : zonePhotos;
          if (list.length === 0) {
            return (
              <div className="flex flex-col items-center gap-2 py-4 text-muted-foreground">
                <ImageOff className="w-5 h-5 opacity-50" />
                <span className="text-[11px]">No photos uploaded yet.</span>
                <Link
                  to="/import/$fcpId"
                  params={{ fcpId }}
                  search={{ project: undefined }}
                  className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90"
                >
                  <Upload className="w-3.5 h-3.5" /> Import photos
                </Link>
              </div>
            );
          }
          return (
            <>
              <div className="grid grid-cols-3 gap-1.5 max-h-56 overflow-y-auto">
                {list.map((p) => {
                  const ring =
                    p.status === "compliant"
                      ? "ring-success"
                      : p.status === "flagged"
                        ? "ring-danger"
                        : "ring-muted-foreground/40";
                  return (
                    <Link
                      key={p.id}
                      to="/result/$photoId"
                      params={{ photoId: p.id }}
                      className={`relative block aspect-square rounded-md overflow-hidden ring-2 ${ring}`}
                      title={`${p.status} · ${new Date(p.captured_at).toLocaleString()}`}
                    >
                      <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                      {p.compliance_score != null && (
                        <span
                          className={`absolute top-1 right-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md text-white shadow ${
                            p.compliance_score >= 80
                              ? "bg-success"
                              : p.compliance_score >= 50
                                ? "bg-warning"
                                : "bg-danger"
                          }`}
                        >
                          {Math.round(p.compliance_score)}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
              <Link
                to="/import/$fcpId"
                params={{ fcpId }}
                search={{ project: undefined }}
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-md border border-border hover:bg-surface"
              >
                <Upload className="w-3.5 h-3.5" /> Add more photos
              </Link>
            </>
          );
        })()}
      </div>

      <Link
        to="/zone/$fcpId"
        params={{ fcpId }}
        className="block w-full text-center text-xs font-semibold px-3 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90"
      >
        Open worker view for {fcpId} →
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background border border-border p-2 text-center">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-bold mt-0.5">{value}</div>
    </div>
  );
}

function MapLoading() {
  return (
    <div className="h-full w-full min-h-[200px] flex items-center justify-center">
      <Loader2 className="animate-spin text-primary" />
    </div>
  );
}

const CHECK_LABELS: Record<string, string> = {
  DEPTH_TOO_SHALLOW: "Depth below required minimum",
  RULER_MISSING: "No measuring ruler visible",
  BEDDING_MISSING: "Sand bedding not visible",
  DUCT_NOT_VISIBLE: "Duct bundle not visible",
  PIPE_ENDS_CUT_OFF: "Pipe ends out of frame",
  OBSTRUCTED: "View obstructed",
  LENGTH_UNCLEAR: "Length cannot be estimated",
};

function PhotoDetailPanel({ photo, onClose }: { photo: MapPhoto | null; onClose: () => void }) {
  if (!photo) return null;

  const isCompliant = photo.status === "compliant";
  const isPending = photo.status === "pending";
  const score = photo.compliance_score ?? 0;
  const minDepth = 60;
  const issues = photo.issues ?? [];
  const hasAnalysis = photo.compliance_score != null;

  return (
    <div className="absolute inset-0 z-[1000] bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md my-auto overflow-hidden">
        <div className="relative">
          <img src={photo.image_url} alt="" className="w-full aspect-[4/3] object-cover" />
          <button
            onClick={onClose}
            className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {isCompliant ? (
                <CheckCircle2 className="w-5 h-5 text-success" />
              ) : isPending ? (
                <Loader2 className="w-5 h-5 text-warning" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-danger" />
              )}
              <span
                className={`text-sm font-bold uppercase ${
                  isCompliant ? "text-success" : isPending ? "text-warning" : "text-danger"
                }`}
              >
                {photo.status}
              </span>
            </div>
            {hasAnalysis && (
              <div className="text-right">
                <div className="text-2xl font-bold tabular-nums">{Math.round(score)}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  score / 100
                </div>
              </div>
            )}
          </div>

          {hasAnalysis && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Depth
                </div>
                <div className="text-lg font-bold">
                  {photo.depth_cm != null ? `${photo.depth_cm} cm` : "—"}
                </div>
                <div className={`text-[10px] ${photo.depth_pass ? "text-success" : "text-danger"}`}>
                  {photo.depth_cm == null
                    ? "no ruler"
                    : photo.depth_pass
                      ? `✓ ≥ ${minDepth} cm`
                      : `✗ needs ${minDepth} cm`}
                </div>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Visible length
                </div>
                <div className="text-lg font-bold">
                  {photo.visible_length_m != null ? `~${photo.visible_length_m} m` : "—"}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {photo.visible_length_m != null ? "estimated" : "not estimated"}
                </div>
              </div>
            </div>
          )}

          {issues.length > 0 && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 p-2.5 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-danger font-semibold">
                Issues
              </div>
              {issues.map((c, i) => (
                <div key={c + i} className="text-xs flex items-center gap-1.5">
                  <X className="w-3 h-3 text-danger shrink-0" />
                  {CHECK_LABELS[c] ?? c}
                </div>
              ))}
            </div>
          )}

          {photo.recommendation && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-2.5 text-xs">
              💡 {photo.recommendation}
            </div>
          )}

          {!hasAnalysis && (
            <div className="text-xs text-muted-foreground text-center py-2">
              AI analysis not available for this photo.
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="text-[10px] text-muted-foreground font-mono truncate">
              {photo.trench_id ?? "—"}
              {photo.waypoint_index != null && ` · wp ${photo.waypoint_index}`}
            </div>
            <Link
              to="/result/$photoId"
              params={{ photoId: photo.id }}
              className="text-xs px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90"
            >
              Full inspection →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
