// Per-trench waypoint coverage. Each trench is split into 5 m waypoints; we
// mark a waypoint as covered if any photo in `photos` is snapped to it.
import { useMemo } from "react";
import { pointsAlongTrench } from "@/lib/geo";
import type { ProjectTrench } from "@/lib/project-data";

type CoveragePhoto = {
  trench_id: string | null;
  waypoint_index?: number | null;
};

type Props = {
  trenches: ProjectTrench[];
  photos: CoveragePhoto[];
  // When set, only render trenches whose IDs are in the list.
  filterTrenchIds?: string[];
  // When provided, each row becomes clickable. `firstCoveredWaypoint` is the
  // index of the first waypoint that has a photo, or null if none.
  onRowClick?: (args: { trenchId: string; firstCoveredWaypoint: number | null }) => void;
};

type Row = {
  id: string;
  label: string;
  total: number;
  covered: number;
  waypoints: Array<{ index: number; covered: boolean }>;
};

export function CoverageReport({ trenches, photos, filterTrenchIds, onRowClick }: Props) {
  const rows = useMemo<Row[]>(() => {
    const coveredWaypointsByTrench = new Map<string, Set<number>>();
    const fallbackPhotoCountByTrench = new Map<string, number>();
    for (const p of photos) {
      if (!p.trench_id) continue;
      if (p.waypoint_index != null) {
        const set = coveredWaypointsByTrench.get(p.trench_id) ?? new Set<number>();
        set.add(p.waypoint_index);
        coveredWaypointsByTrench.set(p.trench_id, set);
      } else {
        fallbackPhotoCountByTrench.set(
          p.trench_id,
          (fallbackPhotoCountByTrench.get(p.trench_id) ?? 0) + 1,
        );
      }
    }

    const filter = filterTrenchIds ? new Set(filterTrenchIds) : null;

    return trenches
      .filter((t) => (filter ? filter.has(t.id) : true))
      .map((t) => {
        // Convert [lat, lng] to [lng, lat] for pointsAlongTrench
        const coordsLngLat = t.geometry.map(([lat, lng]) => [lng, lat] as [number, number]);
        const wps = pointsAlongTrench(coordsLngLat, 5);
        const coveredWaypoints = coveredWaypointsByTrench.get(t.id) ?? new Set<number>();
        const fallbackPhotoCount = fallbackPhotoCountByTrench.get(t.id) ?? 0;
        const waypoints = wps.map((w, idx) => ({
          index: w.index,
          covered:
            coveredWaypoints.size > 0
              ? coveredWaypoints.has(w.index)
              : idx < Math.min(fallbackPhotoCount, wps.length),
        }));
        const coveredCount = waypoints.filter((w) => w.covered).length;
        return {
          id: t.id,
          label: t.name || t.id.slice(0, 8),
          total: waypoints.length,
          covered: coveredCount,
          waypoints,
        };
      })
      .sort((a, b) => {
        const pa = a.total === 0 ? 0 : a.covered / a.total;
        const pb = b.total === 0 ? 0 : b.covered / b.total;
        return pa - pb; // worst coverage first
      });
  }, [trenches, photos, filterTrenchIds]);

  if (rows.length === 0) {
    return (
      <div className="card-elevated p-4 text-sm text-muted-foreground">
        No trenches to report on.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const pct = row.total === 0 ? 0 : Math.round((row.covered / row.total) * 100);
        const barClass = pct >= 80 ? "bg-success" : pct >= 40 ? "bg-warning" : "bg-danger";
        const firstCovered = row.waypoints.find((w) => w.covered)?.index ?? null;
        const clickable = !!onRowClick;
        const Inner = (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{row.label}</p>
                <p className="text-xs text-muted-foreground font-mono">{row.id}</p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-muted-foreground">
                  {row.covered} / {row.total} waypoints
                </div>
                <div className="text-sm font-semibold tabular-nums">{pct}% covered</div>
              </div>
            </div>

            <div className="w-full h-1.5 rounded-full bg-surface overflow-hidden">
              <div className={`h-full ${barClass} transition-all`} style={{ width: `${pct}%` }} />
            </div>

            <div className="flex flex-wrap gap-1">
              {row.waypoints.map((w) => (
                <span
                  key={w.index}
                  title={`Waypoint ${w.index} — ${w.covered ? "covered" : "uncovered"}`}
                  className={`inline-block w-2.5 h-2.5 rounded-full ${
                    w.covered ? "bg-success" : "bg-muted"
                  }`}
                />
              ))}
            </div>
            {clickable && (
              <p className="text-[10px] text-primary/80 pt-1">Click to view on dashboard map →</p>
            )}
          </>
        );
        if (clickable) {
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => onRowClick!({ trenchId: row.id, firstCoveredWaypoint: firstCovered })}
              className="card-elevated p-4 space-y-2 text-left w-full hover:ring-2 hover:ring-primary/40 hover:bg-surface/50 transition-all cursor-pointer"
            >
              {Inner}
            </button>
          );
        }
        return (
          <div key={row.id} className="card-elevated p-4 space-y-2">
            {Inner}
          </div>
        );
      })}
    </div>
  );
}
