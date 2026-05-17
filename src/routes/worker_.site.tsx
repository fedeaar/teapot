import { createFileRoute, Link, useNavigate, ClientOnly } from "@tanstack/react-router";
import { useEffect, useMemo, useState, lazy, Suspense, useCallback } from "react";
import { loadSiteData, type SiteData, type FCP } from "@/lib/site-data";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, MapPin, LogOut, HardHat, Camera } from "lucide-react";
import { getWorkerSession, clearWorkerSession, type WorkerSession } from "@/lib/worker-session";
import { pointsAlongTrench, haversine } from "@/lib/geo";
import { WAYPOINT_FLAG_M } from "@/lib/match-photo";
import type { WaypointDot, WaypointStatus } from "@/components/site/WorkerSiteMap";

// Dev: when true, the Take Photo button activates regardless of distance.
const DEV_BYPASS_DISTANCE = true;

export const Route = createFileRoute("/worker_/site")({
  component: WorkerSitePage,
});

const SiteMap = lazy(() =>
  import("@/components/site/WorkerSiteMap").then((m) => ({ default: m.WorkerSiteMap })),
);

type PhotoRow = {
  trench_id: string | null;
  status: string;
  fcp_id: string | null;
};

function WorkerSitePage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<WorkerSession | null>(null);
  const [site, setSite] = useState<SiteData | null>(null);
  const [user, setUser] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [selectedFcpId, setSelectedFcpId] = useState<string | null>(null);
  const [selectedTrenchId, setSelectedTrenchId] = useState<string | null>(null);

  useEffect(() => {
    const s = getWorkerSession();
    if (!s) {
      navigate({ to: "/worker" });
      return;
    }
    setSession(s);
  }, [navigate]);

  useEffect(() => {
    void loadSiteData().then(setSite);
  }, []);

  const loadPhotos = useCallback(async (projectId: string) => {
    const { data } = await supabase
      .from("images")
      .select("trench_id,status,fcp_id")
      .eq("project_id", projectId);
    if (data) setPhotos(data as PhotoRow[]);
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadPhotos(session.siteId);
    const channel = supabase
      .channel(`worker-photos-${session.siteId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "images",
          filter: `project_id=eq.${session.siteId}`,
        },
        () => {
          void loadPhotos(session.siteId);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session, loadPhotos]);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    let lastUpdate = 0;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const now = Date.now();
        // Throttle to ~1 Hz so noisy phones don't trigger re-render storms.
        if (now - lastUpdate < 1000) return;
        lastUpdate = now;
        setUser({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Compute the waypoints of the selected trench only.
  const selectedTrenchWaypoints: WaypointDot[] = useMemo(() => {
    if (!site || !selectedTrenchId) return [];
    const trench = site.trenches.find((t) => t.id === selectedTrenchId);
    if (!trench) return [];
    const wps = pointsAlongTrench(trench.coords, 5);
    return wps.map((w) => ({
      key: `${trench.id}-${w.index}`,
      trenchId: trench.id,
      index: w.index,
      lat: w.lat,
      lng: w.lng,
      fcpId: trench.fcpId ?? null,
    }));
  }, [site, selectedTrenchId]);

  // Status overlay by trench.
  const statusByTrench = useMemo(() => {
    const m = new Map<string, WaypointStatus>();
    const rank = (s: string) => (s === "compliant" ? 3 : s === "flagged" ? 2 : 1);
    for (const p of photos) {
      if (!p.trench_id) continue;
      const next: WaypointStatus =
        p.status === "compliant" ? "compliant" : p.status === "flagged" ? "flagged" : "pending";
      const prev = m.get(p.trench_id);
      if (!prev || rank(next) > rank(prev)) m.set(p.trench_id, next);
    }
    return m;
  }, [photos]);
  void statusByTrench;

  // Nearest waypoint *within the selected trench* to the user.
  const nearest = useMemo(() => {
    if (!user || selectedTrenchWaypoints.length === 0) return null;
    let best: { wp: WaypointDot; distanceM: number } | null = null;
    for (const wp of selectedTrenchWaypoints) {
      const d = haversine({ lat: user.lat, lng: user.lng }, { lat: wp.lat, lng: wp.lng });
      if (!best || d < best.distanceM) best = { wp, distanceM: d };
    }
    return best;
  }, [user, selectedTrenchWaypoints]);

  function goCapture(wp: WaypointDot) {
    if (!session || !wp.fcpId) return;
    navigate({
      to: "/capture/$waypointId",
      params: { waypointId: `${wp.trenchId}-${wp.index}` },
      search: {
        fcp: wp.fcpId,
        lat: wp.lat,
        lng: wp.lng,
        trench: wp.trenchId,
        project: session.siteId,
      },
    });
  }

  function exit() {
    clearWorkerSession();
    navigate({ to: "/worker" });
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  }

  const inRange = !!nearest && (DEV_BYPASS_DISTANCE || nearest.distanceM <= WAYPOINT_FLAG_M);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <HardHat className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight truncate">{session.siteName}</h1>
            <p className="text-[10px] text-muted-foreground font-mono">
              {session.code} · expires {new Date(session.expiresAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <button
          onClick={exit}
          className="text-xs px-2 py-1.5 rounded-md hover:bg-surface flex items-center gap-1"
        >
          <LogOut className="w-3.5 h-3.5" /> Exit
        </button>
      </header>

      <div className="relative h-[calc(100dvh-65px)] min-h-0 overflow-hidden">
        <ClientOnly fallback={<MapLoading />}>
          <Suspense fallback={<MapLoading />}>
            {site ? (
              <SiteMap
                site={site}
                user={user}
                selectedFcpId={selectedFcpId}
                selectedTrenchId={selectedTrenchId}
                onTrenchTap={(t) => setSelectedTrenchId(t.id)}
                onFcpTap={(fcp: FCP) => {
                  if (selectedFcpId !== fcp.id) {
                    setSelectedFcpId(fcp.id);
                    setSelectedTrenchId(null);
                  }
                }}
              />
            ) : (
              <MapLoading />
            )}
          </Suspense>
        </ClientOnly>

        <div className="absolute top-3 left-3 right-3 z-[1000] flex items-center gap-2 flex-wrap">
          <div className="card-elevated px-3 py-1.5 inline-flex items-center gap-2 text-xs">
            <MapPin className="w-3.5 h-3.5 text-primary" />
            {user ? (
              <span className="font-mono">±{user.accuracy.toFixed(1)}m</span>
            ) : (
              <span className="text-muted-foreground">Acquiring GPS…</span>
            )}
          </div>
          <div className="card-elevated px-3 py-1.5 inline-flex items-center gap-1.5 text-xs">
            <button
              onClick={() => {
                setSelectedFcpId(null);
                setSelectedTrenchId(null);
              }}
              className={`hover:text-primary transition ${
                !selectedFcpId ? "text-primary font-semibold" : "text-muted-foreground"
              }`}
            >
              All zones
            </button>
            {selectedFcpId && (
              <>
                <span className="text-muted-foreground">›</span>
                <button
                  onClick={() => setSelectedTrenchId(null)}
                  className={`hover:text-primary transition ${
                    !selectedTrenchId ? "text-primary font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {selectedFcpId}
                </button>
              </>
            )}
            {selectedTrenchId && (
              <>
                <span className="text-muted-foreground">›</span>
                <span className="text-primary font-semibold">{selectedTrenchId}</span>
              </>
            )}
          </div>
          {(selectedFcpId || selectedTrenchId) && (
            <button
              onClick={() => {
                setSelectedFcpId(null);
                setSelectedTrenchId(null);
              }}
              className="card-elevated px-3 py-1.5 text-xs hover:bg-surface"
            >
              Clear
            </button>
          )}
        </div>

        {!selectedFcpId && (
          <div className="absolute top-16 left-3 right-3 z-[999] card-elevated px-3 py-2 text-xs text-muted-foreground text-center pointer-events-none">
            Tap a zone (green badge) to begin
          </div>
        )}
        {selectedFcpId && !selectedTrenchId && (
          <div className="absolute top-16 left-3 right-3 z-[999] card-elevated px-3 py-2 text-xs text-muted-foreground text-center pointer-events-none">
            Tap a highlighted trench to take its photo
          </div>
        )}

        <div className="absolute bottom-3 left-3 right-3 z-[1000]">
          {!selectedTrenchId ? (
            <div className="card-elevated px-4 py-3 text-xs text-muted-foreground">
              Tap a zone, then a trench, to start capturing.
            </div>
          ) : !user ? (
            <div className="card-elevated px-4 py-3 text-xs text-muted-foreground">
              Waiting for GPS… stand outside and accept the location prompt.
            </div>
          ) : !nearest ? (
            <div className="card-elevated px-4 py-3 text-xs text-muted-foreground">
              No capture points on this trench.
            </div>
          ) : (
            <div className="card-elevated p-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Closest point on {nearest.wp.trenchId}
                </div>
                <div className="text-sm font-semibold truncate">
                  {nearest.wp.fcpId} · {nearest.wp.trenchId} · #{nearest.wp.index + 1}
                </div>
                <div className={`text-xs ${inRange ? "text-success" : "text-warning"}`}>
                  {nearest.distanceM < 1
                    ? "You're on it"
                    : `${Math.round(nearest.distanceM)} m away`}
                  {!inRange && " — walk closer to capture"}
                </div>
              </div>
              <button
                onClick={() => goCapture(nearest.wp)}
                disabled={!inRange}
                className={`shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm transition ${
                  inRange
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-surface text-muted-foreground cursor-not-allowed"
                }`}
              >
                <Camera className="w-4 h-4" /> Take photo
              </button>
            </div>
          )}
        </div>
      </div>
      <Link to="/worker" className="hidden">
        workaround for typed link tree
      </Link>
    </div>
  );
}

function MapLoading() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-background">
      <Loader2 className="animate-spin text-primary" />
    </div>
  );
}
