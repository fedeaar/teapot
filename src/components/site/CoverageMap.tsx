import { Fragment, useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Polyline, Polygon, Marker, CircleMarker, Tooltip, Pane, useMap } from "react-leaflet";
import L from "leaflet";
import type { ProjectData, ProjectFCP } from "@/lib/project-data";
import {
  type CoverageResult,
  photoClass,
  statusColor,
  statusGlow,
  trenchColoredSegments,
} from "@/lib/coverage";
import { pointsAlongTrench, nearestPointOnTrenches, haversine } from "@/lib/geo";

function fcpIcon(name: string, status: "green" | "yellow" | "red", selected: boolean) {
  const c = statusColor(status);
  const g = statusGlow(status);
  const html = `
    <div style="
      min-width:48px;padding:3px 8px;border-radius:12px;
      background:#0d0d12;border:2px solid ${c};
      box-shadow:0 0 ${selected ? 24 : 14}px ${g}${selected ? "cc" : "80"};
      color:#fff;font-family:Inter,sans-serif;
      font-size:11px;line-height:1.1;text-align:center;font-weight:700;
      transform:scale(${selected ? 1.2 : 1});transition:transform .25s ease;
    ">${name}</div>`;
  return L.divIcon({ html, className: "", iconSize: [48, 22], iconAnchor: [24, 11] });
}

function FitToSite({
  site,
  selectedFcpId,
  selectedTrenchId,
  selectedWaypointIndex,
  flyToCoords,
  onFlyToDone,
}: {
  site: ProjectData;
  selectedFcpId: string | null;
  selectedTrenchId: string | null;
  selectedWaypointIndex: number | null;
  flyToCoords?: [number, number] | null;
  onFlyToDone?: () => void;
}) {
  const map = useMap();

  // Invalidate map size when selection changes (sidebar may resize)
  useEffect(() => {
    setTimeout(() => map.invalidateSize(), 100);
  }, [map, selectedFcpId, selectedTrenchId]);

  // Initial fit — ProjectData coords are already [lat, lng]
  useEffect(() => {
    if (selectedFcpId) return;
    if (site.fcps.length) {
      const pts = site.fcps
        .filter((f) => f.lat != null && f.lng != null)
        .map((f) => [f.lat!, f.lng!] as [number, number]);
      if (pts.length) {
        const b = L.latLngBounds(pts);
        map.fitBounds(b, { padding: [50, 50] });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, site]);

  // Animated zoom on selection change
  useEffect(() => {
    // 1) Waypoint selected → fly to that point
    if (selectedTrenchId && selectedWaypointIndex != null) {
      const t = site.trenches.find((x) => x.id === selectedTrenchId);
      if (t) {
        // geometry is [lat, lng] but pointsAlongTrench expects [lng, lat]
        const coordsLngLat = t.geometry.map(([lat, lng]) => [lng, lat] as [number, number]);
        const wps = pointsAlongTrench(coordsLngLat, 5);
        const wp = wps[selectedWaypointIndex];
        if (wp) {
          map.flyTo([wp.lat, wp.lng], 19, { duration: 0.6 });
          return;
        }
      }
    }

    // 2) Trench selected (no waypoint) → fit to that trench
    if (selectedTrenchId) {
      const t = site.trenches.find((x) => x.id === selectedTrenchId);
      if (t && t.geometry.length) {
        const b = L.latLngBounds(t.geometry); // already [lat, lng]
        map.flyToBounds(b, { padding: [80, 80], duration: 0.7, maxZoom: 19 });
        return;
      }
    }

    // 3) No zone selected → back to site overview
    if (!selectedFcpId) {
      const allPts = site.fcps
        .filter((f) => f.lat != null && f.lng != null)
        .map((f) => [f.lat!, f.lng!] as [number, number]);
      if (allPts.length) {
        map.flyToBounds(L.latLngBounds(allPts), { padding: [40, 40], duration: 0.9 });
      }
      return;
    }

    // 4) Zone selected → fit to its polygon / trenches / marker
    const fcpPoly = site.fcpPolygons[selectedFcpId];
    if (fcpPoly) {
      const b = L.latLngBounds(fcpPoly); // already [lat, lng]
      map.flyToBounds(b, { padding: [60, 60], duration: 0.9, maxZoom: 19 });
      return;
    }
    const trenches = site.trenchesByFcp[selectedFcpId] ?? [];
    if (trenches.length) {
      const pts = trenches.flatMap((t) => t.geometry); // already [lat, lng]
      map.flyToBounds(L.latLngBounds(pts), { padding: [60, 60], duration: 0.9, maxZoom: 19 });
      return;
    }
    const fcp = site.fcps.find((f) => f.id === selectedFcpId);
    if (fcp && fcp.lat != null && fcp.lng != null) map.flyTo([fcp.lat, fcp.lng], 18, { duration: 0.9 });
  }, [map, site, selectedFcpId, selectedTrenchId, selectedWaypointIndex]);

  // Fly to specific coordinates (e.g. from "Show on map")
  useEffect(() => {
    if (!flyToCoords) return;
    map.flyTo(flyToCoords, 18, { duration: 0.8 });
    onFlyToDone?.();
  }, [map, flyToCoords, onFlyToDone]);

  return null;
}

export type MapPhotoDot = {
  id: string;
  latitude: number;
  longitude: number;
  status: string;
  verdict: string | null;
  trench_id: string | null;
  image_url: string;
  fcp_id: string | null;
  waypoint_index: number | null;
};

const PHOTO_COLORS: Record<string, string> = {
  compliant: "#22c55e",
  flagged: "#ef4444",
  pending: "#f59e0b",
};

export function CoverageMap({
  site,
  coverage,
  onFcpTap,
  filter,
  selectedFcpId,
  onZoneSelect,
  selectedTrenchId,
  onTrenchSelect,
  selectedWaypointIndex,
  onWaypointSelect,
  photos,
  onPhotoClick,
  flyToCoords,
  onFlyToDone,
}: {
  site: ProjectData;
  coverage: CoverageResult;
  onFcpTap?: (fcp: ProjectFCP) => void;
  filter?: "green" | "yellow" | "red" | null;
  selectedFcpId?: string | null;
  onZoneSelect?: (fcpId: string | null) => void;
  selectedTrenchId?: string | null;
  onTrenchSelect?: (trenchId: string | null) => void;
  selectedWaypointIndex?: number | null;
  onWaypointSelect?: (index: number | null) => void;
  photos?: MapPhotoDot[];
  onPhotoClick?: (photoId: string) => void;
  flyToCoords?: [number, number] | null;
  onFlyToDone?: () => void;
}) {
  const center: [number, number] = useMemo(() => {
    const first = site.fcps.find((f) => f.lat != null && f.lng != null);
    if (first) return [first.lat!, first.lng!];
    return [46.557, 14.291];
  }, [site]);

  // Refs to avoid stale closures in Leaflet event handlers
  const selectedFcpIdRef = useRef(selectedFcpId);
  selectedFcpIdRef.current = selectedFcpId;
  const selectedTrenchIdRef = useRef(selectedTrenchId);
  selectedTrenchIdRef.current = selectedTrenchId;

  // Map each trench to an fcpId for click handling
  const trenchToFcp = useMemo(() => {
    const m: Record<string, string> = {};
    for (const fcpId of Object.keys(site.trenchesByFcp)) {
      for (const t of site.trenchesByFcp[fcpId]) m[t.id] = fcpId;
    }
    return m;
  }, [site]);

  // Many older rows have `trench_id` = null in the DB (the importer's
  // name→UUID lookup missed when geojson codes didn't match `trenches.name`).
  // Reconstruct the trench/waypoint assignment from each photo's lat/lng so
  // halo coloring works regardless of what's stored. Photos farther than
  // SNAP_M from every trench are unassigned.
  const SNAP_M = 30;
  const photosByTrench = useMemo(() => {
    const acc: Record<
      string,
      Array<{ waypoint_index: number; class: "green" | "yellow" | "red" }>
    > = {};
    if (!photos) return acc;
    const trenchInputs = site.trenches.map((t) => ({
      id: t.id,
      coords: t.geometry.map(([lat, lng]) => [lng, lat] as [number, number]),
    }));
    const wpCacheByTrench = new Map<string, { lat: number; lng: number }[]>();
    for (const t of trenchInputs) {
      wpCacheByTrench.set(t.id, pointsAlongTrench(t.coords, 5));
    }
    for (const p of photos) {
      if (p.latitude == null || p.longitude == null) continue;
      const cls = photoClass({
        verdict: p.verdict ?? null,
        status: p.status ?? null,
        fcp_id: null,
      });
      if (!cls) continue;
      const nearest = nearestPointOnTrenches(
        { lat: p.latitude, lng: p.longitude },
        trenchInputs,
      );
      if (!nearest || nearest.distanceM > SNAP_M) continue;
      const wps = wpCacheByTrench.get(nearest.trenchId) ?? [];
      if (wps.length === 0) continue;
      let bestIdx = 0;
      let bestD = Infinity;
      for (let i = 0; i < wps.length; i++) {
        const d = haversine(
          { lat: p.latitude, lng: p.longitude },
          { lat: wps[i].lat, lng: wps[i].lng },
        );
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      }
      const list = acc[nearest.trenchId] ?? [];
      list.push({ waypoint_index: bestIdx, class: cls });
      acc[nearest.trenchId] = list;
    }
    return acc;
  }, [photos, site]);

  return (
    <MapContainer
      center={center}
      zoom={16}
      maxZoom={19}
      style={{ height: "100%", width: "100%", background: "#0a0a0f" }}
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      {/* Strict z-order, back → front: zones < trenches < FCP markers <
          photo dots < tooltips. Custom panes pin each layer's z-index. */}
      <Pane name="zones" style={{ zIndex: 380 }} />
      <Pane name="trenches" style={{ zIndex: 410 }} />
      <Pane name="fcp-markers" style={{ zIndex: 430 }} />
      <Pane name="photo-dots" style={{ zIndex: 500 }} />

      {/* Site cluster boundaries */}
      {site.clusters.map((c) =>
        c.geometry ? (
          <Polygon
            key={`cluster-${c.id}`}
            positions={c.geometry}
            pane="trenches"
            pathOptions={{
              color: "#6366f1",
              weight: 1,
              fillOpacity: 0.03,
              dashArray: "4 6",
              interactive: false,
            }}
          />
        ) : null,
      )}

      {Object.entries(site.fcpPolygons).map(([fcpId, ring]) => {
        const isSelected = selectedFcpId === fcpId;
        const s = coverage.zoneStatus[fcpId] ?? "red";
        const color = statusColor(s);
        return (
          <Polygon
            key={`${fcpId}-${isSelected ? "s" : "u"}`}
            positions={ring} // already [lat, lng]
            pane="zones"
            pathOptions={{
              color,
              weight: isSelected ? 3 : 2,
              opacity: isSelected ? 1 : 0.7,
              fillColor: color,
              fillOpacity: isSelected ? 0.25 : 0.15,
              dashArray: isSelected ? undefined : "6 4",
              className: "cursor-pointer",
            }}
            eventHandlers={
              onZoneSelect
                ? {
                    click: (e) => {
                      L.DomEvent.stopPropagation(e);
                      onZoneSelect(isSelected ? null : fcpId);
                    },
                    mouseover: (e) => {
                      e.target.setStyle({ fillOpacity: 0.3, weight: 3 });
                    },
                    mouseout: (e) => {
                      e.target.setStyle({
                        fillOpacity: isSelected ? 0.25 : 0.15,
                        weight: isSelected ? 3 : 2,
                      });
                    },
                  }
                : undefined
            }
          />
        );
      })}

      {site.trenches.map((t) => {
        const s = coverage.trenchStatus[t.id] ?? "red";
        const matchesFilter = !filter || s === filter;
        const fcpId = trenchToFcp[t.id];
        const matchesZone = !selectedFcpId || fcpId === selectedFcpId;
        const isSelectedTrench = selectedTrenchId === t.id;
        const dim = !matchesFilter || !matchesZone;
        // Each photo on this trench paints a 10 m halo (±5 m around its
        // waypoint). Overlapping halos resolve in favour of the higher
        // class (green > yellow > red). Sections of the trench with no
        // photo halo show the red base polyline underneath.
        const segments = trenchColoredSegments(
          t.geometry,
          photosByTrench[t.id] ?? [],
        );
        const baseWeight = dim ? 1 : isSelectedTrench ? 3 : 2;
        const baseOpacity = dim ? 0.1 : 0.55;
        return (
          <Fragment key={`trench-${t.id}`}>
            <Polyline
              key={`${t.id}-base-${dim ? "d" : "v"}-${isSelectedTrench ? "s" : ""}-${selectedFcpId ? "zs" : "ov"}`}
              positions={t.geometry}
              pane="trenches"
              interactive={!!selectedFcpId && !!onTrenchSelect}
              bubblingMouseEvents={!selectedFcpId}
              pathOptions={{
                color: "#64748b",
                weight: baseWeight,
                opacity: baseOpacity,
                className:
                  selectedFcpId && onTrenchSelect ? "cursor-pointer" : undefined,
              }}
              eventHandlers={{
                click: (e) => {
                  if (!selectedFcpIdRef.current || !onTrenchSelect) return;
                  L.DomEvent.stopPropagation(e);
                  const isSel = selectedTrenchIdRef.current === t.id;
                  onTrenchSelect(isSel ? null : t.id);
                },
              }}
            />
            {segments.map((seg, segIdx) => (
              <Polyline
                key={`${t.id}-halo-${segIdx}-${seg.cls}`}
                positions={seg.coords}
                pane="trenches"
                pathOptions={{
                  color: statusColor(seg.cls),
                  weight: baseWeight + 1,
                  opacity: dim ? 0.15 : 1,
                  className: onTrenchSelect ? "cursor-pointer" : undefined,
                  lineCap: "round",
                }}
                interactive={false}
              />
            ))}
          </Fragment>
        );
      })}

      {selectedTrenchId &&
        (() => {
          const t = site.trenches.find((x) => x.id === selectedTrenchId);
          if (!t) return null;
          // pointsAlongTrench expects [lng, lat], convert from [lat, lng]
          const coordsLngLat = t.geometry.map(([lat, lng]) => [lng, lat] as [number, number]);
          const pts = pointsAlongTrench(coordsLngLat, 5);
          // Build a map of waypoint_index → best photo for this trench
          const wpPhotos: Record<number, MapPhotoDot> = {};
          if (photos) {
            for (const p of photos) {
              if (p.trench_id === selectedTrenchId && p.waypoint_index != null) {
                const existing = wpPhotos[p.waypoint_index];
                // Keep the most relevant photo (green > yellow > red > pending)
                const newCls = photoClass({
                  verdict: p.verdict ?? null,
                  status: p.status ?? null,
                  fcp_id: null,
                });
                const existCls = existing
                  ? photoClass({
                      verdict: existing.verdict ?? null,
                      status: existing.status ?? null,
                      fcp_id: null,
                    })
                  : null;
                const rank = (c: "green" | "yellow" | "red" | null) =>
                  c === "green" ? 3 : c === "yellow" ? 2 : c === "red" ? 1 : 0;
                if (!existing || rank(newCls) > rank(existCls)) {
                  wpPhotos[p.waypoint_index] = p;
                }
              }
            }
          }
          return pts.map((p, idx) => {
            const isSel = selectedWaypointIndex === idx;
            const photo = wpPhotos[idx];
            // Color: green=compliant, yellow=needs_review, red=non_compliant, gray=no photo / pending
            const cls = photo
              ? photoClass({
                  verdict: photo.verdict ?? null,
                  status: photo.status ?? null,
                  fcp_id: null,
                })
              : null;
            const wpColor =
              cls === "green"
                ? "#22c55e"
                : cls === "yellow"
                  ? "#eab308"
                  : cls === "red"
                    ? "#ef4444"
                    : photo
                      ? "#f59e0b"
                      : "#6b7280";
            return (
              <CircleMarker
                key={`wp-${idx}-${isSel ? "s" : "u"}`}
                center={[p.lat, p.lng]}
                radius={isSel ? 9 : photo ? 6 : 4}
                pane="trenches"
                pathOptions={{
                  color: isSel ? "#fbbf24" : photo ? wpColor : "#ffffff",
                  weight: isSel ? 3 : 2,
                  fillColor: isSel ? "#fbbf24" : wpColor,
                  fillOpacity: 1,
                  className: onWaypointSelect ? "cursor-pointer" : undefined,
                }}
                eventHandlers={
                  onWaypointSelect
                    ? {
                        click: (e) => {
                          L.DomEvent.stopPropagation(e);
                          onWaypointSelect(isSel ? null : idx);
                        },
                      }
                    : undefined
                }
              >
                {photo && (
                  <Tooltip
                    direction="top"
                    offset={[0, -8]}
                    opacity={1}
                    className="photo-tooltip"
                  >
                    <div className="w-28">
                      <img
                        src={photo.image_url}
                        alt=""
                        className="w-full h-[66px] object-cover rounded-md mb-1"
                      />
                      <div className="flex items-center gap-1.5">
                        <span
                          className="inline-block w-2 h-2 rounded-full shrink-0"
                          style={{ background: wpColor }}
                        />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground">
                          {(photo.verdict ?? photo.status).replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>
                  </Tooltip>
                )}
              </CircleMarker>
            );
          });
        })()}

      {site.fcps
        .filter((fcp) => fcp.lat != null && fcp.lng != null)
        .map((fcp) => {
          const s = coverage.zoneStatus[fcp.id] ?? "red";
          const matchesFilter = !filter || s === filter;
          const isSelected = selectedFcpId === fcp.id;
          return (
            <Marker
              key={fcp.id}
              position={[fcp.lat!, fcp.lng!]}
              pane="fcp-markers"
              icon={fcpIcon(fcp.name || fcp.id.slice(0, 8), s, isSelected)}
              opacity={matchesFilter ? 1 : 0.25}
              eventHandlers={{
                click: () => {
                  if (onZoneSelect) onZoneSelect(isSelected ? null : fcp.id);
                  if (onFcpTap) onFcpTap(fcp);
                },
              }}
            />
          );
        })}

      {photos?.map((p) => {
        const cls = photoClass({
          verdict: p.verdict ?? null,
          status: p.status ?? null,
          fcp_id: null,
        });
        const color =
          cls === "green"
            ? "#22c55e"
            : cls === "yellow"
              ? "#eab308"
              : cls === "red"
                ? "#ef4444"
                : (PHOTO_COLORS[p.status] ?? "#94a3b8");
        const matchesFilter = !filter || cls === filter;
        const inZone = !selectedFcpId || p.fcp_id === selectedFcpId;
        const inTrench = !selectedTrenchId || p.trench_id === selectedTrenchId;
        const dim = !matchesFilter || !inZone;
        const radius = selectedTrenchId && inTrench ? 9 : selectedFcpId && inZone ? 8 : 6;
        return (
          <CircleMarker
            key={`photo-${p.id}`}
            center={[p.latitude, p.longitude]}
            radius={radius}
            pane="photo-dots"
            bubblingMouseEvents={false}
            pathOptions={{
              color: "#0a0a0f",
              weight: 2,
              fillColor: color,
              fillOpacity: dim ? 0.2 : 0.95,
              className: "cursor-pointer",
            }}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                if (onPhotoClick) onPhotoClick(p.id);
              },
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -8]}
              opacity={1}
              className="photo-tooltip"
            >
              <div className="w-32">
                <img
                  src={p.image_url}
                  alt=""
                  className="w-full h-20 object-cover rounded-md mb-1.5"
                />
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ background: color }}
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground">
                    {(p.verdict ?? p.status).replace(/_/g, " ")}
                  </span>
                </div>
                {p.trench_id && (
                  <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                    {p.trench_id.slice(0, 8)}
                  </div>
                )}
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}

      <FitToSite
        site={site}
        selectedFcpId={selectedFcpId ?? null}
        selectedTrenchId={selectedTrenchId ?? null}
        selectedWaypointIndex={selectedWaypointIndex ?? null}
        flyToCoords={flyToCoords}
        onFlyToDone={onFlyToDone}
      />
    </MapContainer>
  );
}
