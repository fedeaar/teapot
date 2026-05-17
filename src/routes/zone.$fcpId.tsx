import { createFileRoute, Link, useNavigate, ClientOnly } from "@tanstack/react-router";
import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { z } from "zod";
import { loadProjectData, type ProjectData } from "@/lib/project-data";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ArrowLeft, MapPin } from "lucide-react";
import type { PhotoDot } from "@/components/site/ZoneMap";

const zoneSearchSchema = z.object({
  project: z.string().uuid().optional(),
});

export const Route = createFileRoute("/zone/$fcpId")({
  validateSearch: zoneSearchSchema,
  component: ZonePage,
});

const ZoneMap = lazy(() => import("@/components/site/ZoneMap").then((m) => ({ default: m.ZoneMap })));

type DbPhoto = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
};

function ZonePage() {
  const { fcpId } = Route.useParams();
  const { project: projectId } = Route.useSearch();
  const navigate = useNavigate();
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [user, setUser] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [photos, setPhotos] = useState<DbPhoto[]>([]);
  const [selectedTrenchId, setSelectedTrenchId] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    void loadProjectData(projectId).then(setProjectData);
  }, [projectId]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("images")
        .select("id,latitude,longitude,status")
        .eq("fcp_id", fcpId);
      if (data) setPhotos(data as DbPhoto[]);
    })();
  }, [fcpId]);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setUser({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const trenches = projectData?.trenchesByFcp[fcpId] ?? [];

  const photoDots: PhotoDot[] = useMemo(
    () =>
      photos
        .filter((p) => p.latitude != null && p.longitude != null)
        .map((p) => ({
          id: p.id,
          lat: p.latitude as number,
          lng: p.longitude as number,
          status:
            p.status === "compliant"
              ? "compliant"
              : p.status === "flagged"
                ? "flagged"
                : "pending",
        })),
    [photos],
  );

  const compliantCount = photoDots.filter((p) => p.status === "compliant").length;
  const flaggedCount = photoDots.filter((p) => p.status === "flagged").length;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/" className="p-1.5 rounded-md hover:bg-surface">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Zone {fcpId}</h1>
            <p className="text-xs text-muted-foreground">
              {selectedTrenchId
                ? `${selectedTrenchId} · tap a numbered point to capture`
                : `${trenches.length} trenches · tap a trench to begin`}
            </p>
          </div>
        </div>
        <div className="text-xs">
          <span className="text-success font-semibold">{compliantCount}</span>
          <span className="text-muted-foreground"> ✓ · </span>
          <span className="text-danger font-semibold">{flaggedCount}</span>
          <span className="text-muted-foreground"> ✗</span>
        </div>
      </header>

      <div className="relative h-[calc(100dvh-69px)] min-h-0 overflow-hidden">
        <ClientOnly fallback={<MapLoading />}>
          <Suspense fallback={<MapLoading />}>
            {projectData ? (
              <ZoneMap
                trenches={trenches}
                photos={photoDots}
                user={user}
                selectedTrenchId={selectedTrenchId}
                onTrenchSelect={setSelectedTrenchId}
                onWaypointTap={(w) => {
                  navigate({
                    to: "/capture/$waypointId",
                    params: { waypointId: `${w.trenchId}-${w.index}` },
                    search: {
                      fcp: fcpId,
                      lat: w.lat,
                      lng: w.lng,
                      trench: w.trenchId,
                      project: projectId,
                    },
                  });
                }}
                onPhotoTap={(id) => navigate({ to: "/result/$photoId", params: { photoId: id } })}
              />
            ) : (
              <MapLoading />
            )}
          </Suspense>
        </ClientOnly>

        <div className="absolute top-3 left-3 right-3 flex items-center gap-2 pointer-events-none z-[1000]">
          <div className="card-elevated px-3 py-1.5 flex items-center gap-2 text-xs pointer-events-auto">
            <MapPin className="w-3.5 h-3.5 text-primary" />
            {user ? (
              <span className="font-mono">±{user.accuracy.toFixed(1)}m</span>
            ) : (
              <span className="text-muted-foreground">No GPS</span>
            )}
          </div>
          {selectedTrenchId && (
            <button
              onClick={() => setSelectedTrenchId(null)}
              className="card-elevated px-3 py-1.5 text-xs pointer-events-auto hover:bg-surface"
            >
              Clear selection
            </button>
          )}
        </div>

        {!selectedTrenchId && (
          <div className="absolute bottom-4 left-3 right-3 z-[1000] card-elevated p-3 text-center text-sm text-muted-foreground">
            Tap a trench line to reveal 5 m capture points.
          </div>
        )}
      </div>
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
