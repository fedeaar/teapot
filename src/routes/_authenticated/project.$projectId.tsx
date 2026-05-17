import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getProject } from "@/lib/projects.functions";
import { loadProjectData, type ProjectData } from "@/lib/project-data";
import { computeCoverage, photoClass, type CoverageResult, type PhotoLite } from "@/lib/coverage";
import { METERS_PER_PHOTO } from "@/lib/validate-photo.functions";
import { trenchLength, pointsAlongTrench } from "@/lib/geo";
import { supabase } from "@/integrations/supabase/client";
import { GeoJsonImporter } from "@/components/site/GeoJsonImporter";
import { PhotoImporter } from "@/components/site/PhotoImporter";
import { UploadedPhotosSection } from "@/components/site/UploadedPhotosSection";
import {
  ArrowLeft,
  Loader2,
  Map,
  Upload,
  Image,
  FileJson,
  Activity,
  AlertTriangle,
  CheckCircle2,
  X,
  MapPin,
  Camera,
  ImageOff,
  FileText,
} from "lucide-react";
import { ClientOnly } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/project/$projectId")({
  component: ProjectDetailPage,
});

type Tab = "map" | "geojson" | "photos" | "gallery";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "map", label: "Map", icon: <Map className="w-3.5 h-3.5" /> },
  { id: "geojson", label: "Import GeoJSON", icon: <FileJson className="w-3.5 h-3.5" /> },
  { id: "photos", label: "Import Photos", icon: <Upload className="w-3.5 h-3.5" /> },
  { id: "gallery", label: "Photos", icon: <Image className="w-3.5 h-3.5" /> },
];

// --- Photo types ---

export type MapPhoto = {
  id: string;
  latitude: number;
  longitude: number;
  status: string;
  verdict: string | null;
  trench_id: string | null;
  image_url: string;
  fcp_id: string | null;
  compliance_score: number | null;
  depth_cm: number | null;
  depth_pass: boolean | null;
  ruler_visible: boolean | null;
  bedding_visible: boolean | null;
  duct_bundle_visible: boolean | null;
  unobstructed: boolean | null;
  issues: string[] | null;
  recommendation: string | null;
  captured_at: string | null;
  analyzed_at: string | null;
  filename: string | null;
  cluster_id: string | null;
  project_id: string | null;
  waypoint_index: number | null;
};

type StatusFilter = "green" | "yellow" | "red" | null;

const CoverageMap = lazy(() =>
  import("@/components/site/CoverageMap").then((m) => ({ default: m.CoverageMap })),
);

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const fetchProject = useServerFn(getProject);

  const [project, setProject] = useState<{
    id: string;
    name: string;
    description: string | null;
    created_by: string;
    created_at: string;
  } | null>(null);
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("map");
  const [refreshKey, setRefreshKey] = useState(0);

  // Photo state
  const [photos, setPhotos] = useState<PhotoLite[]>([]);
  const [mapPhotos, setMapPhotos] = useState<MapPhoto[]>([]);

  // Map selection state
  const [filter, setFilter] = useState<StatusFilter>(null);
  const [selectedFcpId, setSelectedFcpId] = useState<string | null>(null);
  const [selectedTrenchId, setSelectedTrenchId] = useState<string | null>(null);
  const [selectedWaypointIndex, setSelectedWaypointIndex] = useState<number | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [flyToCoords, setFlyToCoords] = useState<[number, number] | null>(null);

  function handleShowOnMap(photo: {
    id: string;
    latitude: number;
    longitude: number;
    fcp_id: string | null;
  }) {
    setSelectedFcpId(photo.fcp_id);
    setSelectedPhotoId(photo.id);
    setFlyToCoords([photo.latitude, photo.longitude]);
    setTab("map");
  }

  // Reset trench/waypoint when zone changes (skip first mount)
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

  async function loadAll() {
    setLoading(true);
    try {
      const [res, data] = await Promise.all([
        fetchProject({ data: { projectId } }),
        loadProjectData(projectId),
      ]);
      setProject(res.project);
      setProjectData(data);
      const isEmpty =
        data.clusters.length === 0 && data.fcps.length === 0 && data.trenches.length === 0;
      if (isEmpty) setTab("geojson");
    } catch (e: any) {
      console.error("Failed to load project", e?.message ?? e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Photo loading with realtime subscription
  const loadPhotos = useCallback(async () => {
    const { data } = await supabase
      .from("images")
      .select(
        "id,fcp_id,status,latitude,longitude,trench_id,image_url,compliance_score,depth_cm,depth_pass,ruler_visible,bedding_visible,duct_bundle_visible,unobstructed,issues,recommendation,captured_at,verdict,analyzed_at,filename,cluster_id,project_id,waypoint_index",
      )
      .eq("project_id", projectId);
    if (!data) return;
    setPhotos(
      data.map((d) => ({
        fcp_id: d.fcp_id,
        trench_id: d.trench_id,
        waypoint_index: d.waypoint_index as number | null,
        status: d.status ?? "pending",
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
          status: d.status ?? "pending",
          verdict: d.verdict,
          trench_id: d.trench_id,
          image_url: d.image_url,
          fcp_id: d.fcp_id,
          waypoint_index: null,
          compliance_score: d.compliance_score as number | null,
          depth_cm: d.depth_cm as number | null,
          depth_pass: d.depth_pass,
          ruler_visible: d.ruler_visible,
          bedding_visible: d.bedding_visible,
          duct_bundle_visible: d.duct_bundle_visible,
          unobstructed: d.unobstructed,
          issues: (d.issues as string[] | null) ?? null,
          recommendation: d.recommendation,
          captured_at: d.captured_at,
          analyzed_at: d.analyzed_at,
          filename: d.filename,
          cluster_id: d.cluster_id,
          project_id: d.project_id,
        })),
    );
  }, [projectId]);

  useEffect(() => {
    void loadPhotos();
    const channel = supabase
      .channel(`project-photos-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "images", filter: `project_id=eq.${projectId}` },
        () => {
          void loadPhotos();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadPhotos, projectId]);

  const coverage: CoverageResult | null = useMemo(
    () => (projectData ? computeCoverage(projectData, photos) : null),
    [projectData, photos],
  );

  function onImported() {
    void loadProjectData(projectId).then(setProjectData);
    setRefreshKey((k) => k + 1);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        Project not found.
      </div>
    );
  }

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <header className="px-4 py-3 border-b border-border flex items-center gap-3 bg-surface">
        <Link to="/projects" className="p-1.5 rounded-md hover:bg-background">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold tracking-tight">{project.name}</h1>
          {project.description && (
            <p className="text-[11px] text-muted-foreground truncate">{project.description}</p>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground shrink-0">
          {projectData
            ? `${projectData.clusters.length} clusters, ${projectData.fcps.length} FCPs, ${projectData.trenches.length} trenches`
            : ""}
        </div>
        <Link
          to="/report"
          search={{ project: projectId }}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted"
        >
          <FileText className="w-3.5 h-3.5" /> Report
        </Link>
      </header>

      {/* Tabs */}
      <div className="border-b border-border bg-surface px-4 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "map" && (
          <MapTab
            projectData={projectData}
            coverage={coverage}
            photos={photos}
            mapPhotos={mapPhotos}
            filter={filter}
            onFilterChange={setFilter}
            selectedFcpId={selectedFcpId}
            onZoneSelect={setSelectedFcpId}
            selectedTrenchId={selectedTrenchId}
            onTrenchSelect={setSelectedTrenchId}
            selectedWaypointIndex={selectedWaypointIndex}
            onWaypointSelect={setSelectedWaypointIndex}
            selectedPhotoId={selectedPhotoId}
            onPhotoClick={setSelectedPhotoId}
            projectId={projectId}
            flyToCoords={flyToCoords}
            onFlyToDone={() => setFlyToCoords(null)}
          />
        )}
        {tab === "geojson" && (
          <div className="h-full overflow-y-auto">
            <div className="max-w-2xl mx-auto p-4">
              <GeoJsonImporter projectId={projectId} onImported={onImported} />
            </div>
          </div>
        )}
        {tab === "photos" && (
          <div className="h-full overflow-y-auto">
            <PhotoImporter
              projectId={projectId}
              onBack={() => setTab("map")}
              title={`Import photos - ${project.name}`}
              onImported={onImported}
            />
          </div>
        )}
        {tab === "gallery" && (
          <div className="h-full overflow-y-auto">
            <div className="max-w-4xl mx-auto p-4">
              <UploadedPhotosSection refreshKey={refreshKey} onShowOnMap={handleShowOnMap} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Map Tab (full dashboard layout) ---

function MapTab({
  projectData,
  coverage,
  photos,
  mapPhotos,
  filter,
  onFilterChange,
  selectedFcpId,
  onZoneSelect,
  selectedTrenchId,
  onTrenchSelect,
  selectedWaypointIndex,
  onWaypointSelect,
  selectedPhotoId,
  onPhotoClick,
  projectId,
  flyToCoords,
  onFlyToDone,
}: {
  projectData: ProjectData | null;
  coverage: CoverageResult | null;
  photos: PhotoLite[];
  mapPhotos: MapPhoto[];
  filter: StatusFilter;
  onFilterChange: (f: StatusFilter) => void;
  selectedFcpId: string | null;
  onZoneSelect: (fcpId: string | null) => void;
  selectedTrenchId: string | null;
  onTrenchSelect: (id: string | null) => void;
  selectedWaypointIndex: number | null;
  onWaypointSelect: (i: number | null) => void;
  selectedPhotoId: string | null;
  onPhotoClick: (id: string | null) => void;
  projectId: string;
  flyToCoords?: [number, number] | null;
  onFlyToDone?: () => void;
}) {
  if (!projectData) {
    return (
      <div className="h-full flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      </div>
    );
  }

  if (
    projectData.clusters.length === 0 &&
    projectData.fcps.length === 0 &&
    projectData.trenches.length === 0
  ) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-muted-foreground gap-3">
        <Map className="w-8 h-8 opacity-50" />
        <p className="text-sm">No geometry imported yet.</p>
        <p className="text-xs">Switch to the "Import GeoJSON" tab to upload site data.</p>
      </div>
    );
  }

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[1fr_360px] min-h-0">
      {/* Map column */}
      <div className="relative h-full min-h-0">
        <ClientOnly fallback={<MapLoading />}>
          <Suspense fallback={<MapLoading />}>
            {coverage ? (
              <CoverageMap
                site={projectData}
                coverage={coverage}
                filter={filter}
                selectedFcpId={selectedFcpId}
                onZoneSelect={onZoneSelect}
                selectedTrenchId={selectedTrenchId}
                onTrenchSelect={onTrenchSelect}
                selectedWaypointIndex={selectedWaypointIndex}
                onWaypointSelect={onWaypointSelect}
                photos={mapPhotos}
                onPhotoClick={onPhotoClick}
                flyToCoords={flyToCoords}
                onFlyToDone={onFlyToDone}
              />
            ) : (
              <MapLoading />
            )}
          </Suspense>
        </ClientOnly>
        {selectedPhotoId && (
          <PhotoDetailPanel
            photo={mapPhotos.find((p) => p.id === selectedPhotoId) ?? null}
            onClose={() => onPhotoClick(null)}
          />
        )}
      </div>

      {/* Sidebar column */}
      <aside className="border-t lg:border-t-0 lg:border-l border-border overflow-y-auto bg-surface">
        {coverage && projectData ? (
          selectedFcpId ? (
            <ZoneDetail
              site={projectData}
              coverage={coverage}
              fcpId={selectedFcpId}
              selectedTrenchId={selectedTrenchId}
              onTrenchSelect={onTrenchSelect}
              selectedWaypointIndex={selectedWaypointIndex}
              onWaypointSelect={onWaypointSelect}
              onClose={() => onZoneSelect(null)}
              projectId={projectId}
            />
          ) : (
            <Sidebar
              coverage={coverage}
              site={projectData}
              filter={filter}
              onFilterChange={onFilterChange}
              onZoneSelect={onZoneSelect}
            />
          )
        ) : (
          <MapLoading />
        )}
      </aside>
    </div>
  );
}

// --- Sidebar ---

function Sidebar({
  coverage,
  site,
  filter,
  onFilterChange,
  onZoneSelect,
}: {
  coverage: CoverageResult;
  site: ProjectData;
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
        title="COMPLIANT"
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
        title="NEEDS REVIEW"
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
        title="NON-COMPLIANT"
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
        <BarRow label="COMPLIANT" pct={t.greenPct} color="bg-success" />
        <BarRow label="NEEDS REVIEW" pct={t.yellowPct} color="bg-warning" />
        <BarRow label="NON-COMPLIANT" pct={t.redPct} color="bg-danger" />
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
                  <span className="text-xs font-semibold">{f.name || f.id.slice(0, 8)}</span>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {f.address ?? ""}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                  {stats ? `${stats.compliant}/${stats.needed}` : "---"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl bg-primary/10 border border-primary/30 p-3 text-xs">
        <div className="font-semibold mb-1">AI auto-classifies every trench segment</div>
        <p className="text-muted-foreground">
          Each photo from the field is geo-checked, validated by AI, and rolled up into the live
          coverage map you see here.
        </p>
      </div>
    </div>
  );
}

// --- Status Card ---

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

// --- Bar Row ---

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

// --- Zone Detail ---

type ZonePhoto = {
  id: string;
  image_url: string;
  status: string;
  verdict: string | null;
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
  projectId,
}: {
  site: ProjectData;
  coverage: CoverageResult;
  fcpId: string;
  selectedTrenchId: string | null;
  onTrenchSelect: (id: string | null) => void;
  selectedWaypointIndex: number | null;
  onWaypointSelect: (i: number | null) => void;
  onClose: () => void;
  projectId: string;
}) {
  const selectedTrench = selectedTrenchId
    ? site.trenches.find((t) => t.id === selectedTrenchId)
    : null;
  const waypoints = useMemo(() => {
    if (!selectedTrench) return [];
    const coordsLngLat = selectedTrench.geometry.map(
      ([lat, lng]) => [lng, lat] as [number, number],
    );
    return pointsAlongTrench(coordsLngLat, 5);
  }, [selectedTrench]);
  const [zonePhotos, setZonePhotos] = useState<ZonePhoto[]>([]);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("images")
        .select("id,image_url,status,verdict,trench_id,captured_at,compliance_score")
        .eq("fcp_id", fcpId)
        .order("captured_at", { ascending: false });
      setZonePhotos((data as ZonePhoto[]) ?? []);
    })();
  }, [fcpId]);
  const fcp = site.fcps.find((f) => f.id === fcpId);
  const stats = coverage.zoneStats[fcpId];
  const trenches = site.trenchesByFcp[fcpId] ?? [];
  const totalM = trenches.reduce((s, t) => {
    const coordsLngLat = t.geometry.map(([lat, lng]) => [lng, lat] as [number, number]);
    return s + trenchLength(coordsLngLat);
  }, 0);

  return (
    <div className="p-4 space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Zone</div>
          <h2 className="text-xl font-bold tracking-tight">{fcp?.name || fcpId.slice(0, 8)}</h2>
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

      {/* Zone-scoped traffic-light breakdown — uses this zone's photos and
          this zone's trench length only. Each tile shows that class's
          percentage of the zone's trench length plus the photo count. Red
          picks up everything not covered by green or yellow so the three
          percentages sum to 100. */}
      <ZoneCoverageCard photos={zonePhotos} totalM={totalM} />

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
            const coordsLngLat = t.geometry.map(([lat, lng]) => [lng, lat] as [number, number]);
            const len = trenchLength(coordsLngLat);
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
                  <span className="text-xs font-mono truncate">{t.name || t.id.slice(0, 8)}</span>
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
            <span>5m waypoints · {selectedTrench.name || selectedTrench.id.slice(0, 8)}</span>
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
                · trench {selectedTrench?.name || selectedTrenchId.slice(0, 8)}
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
              </div>
            );
          }
          return (
            <div className="grid grid-cols-3 gap-1.5 max-h-56 overflow-y-auto">
              {list.map((p) => {
                const ringColor =
                  p.verdict === "compliant"
                    ? "ring-success"
                    : p.verdict === "flagged"
                      ? "ring-danger"
                      : p.status === "analyzed" &&
                          (p.verdict === "non_compliant" || p.verdict === "needs_review")
                        ? "ring-warning"
                        : "ring-muted-foreground/40";
                return (
                  <Link
                    key={p.id}
                    to="/result/$photoId"
                    params={{ photoId: p.id }}
                    className={`relative block aspect-square rounded-md overflow-hidden ring-2 ${ringColor}`}
                    title={`${p.status} · ${p.captured_at ? new Date(p.captured_at).toLocaleString() : "unknown"}`}
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
          );
        })()}
      </div>
    </div>
  );
}

// --- Stat ---

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background border border-border p-2 text-center">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-bold mt-0.5">{value}</div>
    </div>
  );
}

// --- Map Loading ---

function MapLoading() {
  return (
    <div className="h-full w-full min-h-[200px] flex items-center justify-center">
      <Loader2 className="animate-spin text-primary" />
    </div>
  );
}

// --- Photo Detail Panel ---

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

  const isCompliant = photo.verdict === "compliant";
  const isPending = photo.status === "pending";
  const isFlagged = photo.verdict === "flagged";
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
                <Loader2 className="w-5 h-5 text-muted-foreground" />
              ) : isFlagged ? (
                <AlertTriangle className="w-5 h-5 text-danger" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-warning" />
              )}
              <span
                className={`text-sm font-bold uppercase ${
                  isCompliant
                    ? "text-success"
                    : isPending
                      ? "text-muted-foreground"
                      : isFlagged
                        ? "text-danger"
                        : "text-warning"
                }`}
              >
                {photo.verdict ?? photo.status}
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
                  {photo.depth_cm != null ? `${photo.depth_cm} cm` : "---"}
                </div>
                <div className={`text-[10px] ${photo.depth_pass ? "text-success" : "text-danger"}`}>
                  {photo.depth_cm == null
                    ? "no ruler"
                    : photo.depth_pass
                      ? `>= ${minDepth} cm`
                      : `needs ${minDepth} cm`}
                </div>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Verdict
                </div>
                <div className="text-lg font-bold capitalize">
                  {photo.verdict ? photo.verdict.replace("_", " ") : "---"}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {photo.analyzed_at
                    ? `analyzed ${new Date(photo.analyzed_at).toLocaleDateString()}`
                    : "not analyzed"}
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
              {photo.recommendation}
            </div>
          )}

          {!hasAnalysis && (
            <div className="text-xs text-muted-foreground text-center py-2">
              AI analysis not available for this photo.
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="text-[10px] text-muted-foreground font-mono truncate">
              {photo.trench_id ? photo.trench_id.slice(0, 12) : "---"}
            </div>
            <Link
              to="/result/$photoId"
              params={{ photoId: photo.id }}
              className="text-xs px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90"
            >
              Full inspection
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}


// Three-class breakdown for a single zone: each green/yellow photo gives
// METERS_PER_PHOTO toward coverage; red picks up undocumented length plus
// any red photos so the three percentages sum to 100 %. Each tile shows the
// photo count, the meters, and the percentage of the zone's trench length.
function ZoneCoverageCard({ photos, totalM }: { photos: { verdict: string | null; status: string | null }[]; totalM: number }) {
  let greenCount = 0;
  let yellowCount = 0;
  let redCount = 0;
  for (const p of photos) {
    const c = photoClass({
      verdict: p.verdict ?? null,
      status: p.status ?? null,
      fcp_id: null,
    });
    if (c === "green") greenCount++;
    else if (c === "yellow") yellowCount++;
    else if (c === "red") redCount++;
  }
  const rawGreenM = greenCount * METERS_PER_PHOTO;
  const rawYellowM = yellowCount * METERS_PER_PHOTO;
  const denom = Math.max(totalM, rawGreenM + rawYellowM, 1);
  const greenM = Math.min(rawGreenM, denom);
  const yellowM = Math.min(rawYellowM, denom - greenM);
  const redM = Math.max(0, denom - greenM - yellowM);
  const pct = (v: number) => Math.round((v / denom) * 100);
  return (
    <div className="rounded-xl bg-background border border-border p-3 space-y-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-baseline justify-between">
        <span>Traffic-light coverage (this zone)</span>
        <span className="font-mono text-muted-foreground">
          {Math.round(greenM + yellowM).toLocaleString()} m / {Math.round(denom).toLocaleString()} m
        </span>
      </div>
      <div className="h-3 w-full rounded-full overflow-hidden flex bg-muted">
        {greenM > 0 && <div className="bg-emerald-500" style={{ width: `${pct(greenM)}%` }} />}
        {yellowM > 0 && <div className="bg-amber-500" style={{ width: `${pct(yellowM)}%` }} />}
        {redM > 0 && <div className="bg-red-600" style={{ width: `${pct(redM)}%` }} />}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ZoneClassTile
          color="emerald"
          label="Compliant"
          photos={greenCount}
          meters={greenM}
          pct={pct(greenM)}
        />
        <ZoneClassTile
          color="amber"
          label="Needs review"
          photos={yellowCount}
          meters={yellowM}
          pct={pct(yellowM)}
        />
        <ZoneClassTile
          color="red"
          label="Non-compliant"
          photos={redCount}
          meters={redM}
          pct={pct(redM)}
        />
      </div>
    </div>
  );
}

function ZoneClassTile({
  color,
  label,
  photos,
  meters,
  pct,
}: {
  color: "emerald" | "amber" | "red";
  label: string;
  photos: number;
  meters: number;
  pct: number;
}) {
  const bg =
    color === "emerald"
      ? "bg-emerald-500/10 border-emerald-500/30"
      : color === "amber"
        ? "bg-amber-500/10 border-amber-500/30"
        : "bg-red-500/10 border-red-500/30";
  const text =
    color === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : color === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";
  return (
    <div className={`rounded-md border px-2 py-2 ${bg} flex flex-col gap-0.5`}>
      <div className={`text-[10px] font-semibold uppercase tracking-wide ${text}`}>{label}</div>
      <div className={`text-xl font-bold leading-none ${text}`}>{pct}%</div>
      <div className="text-[11px] text-muted-foreground">
        {photos} photo{photos === 1 ? "" : "s"}
      </div>
      <div className="text-[10px] text-muted-foreground font-mono">
        {Math.round(meters).toLocaleString()} m
      </div>
    </div>
  );
}
