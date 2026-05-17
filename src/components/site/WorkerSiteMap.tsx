import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Polygon,
  Marker,
  Circle,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type { SiteData, FCP, Trench } from "@/lib/site-data";

export type WaypointStatus = "compliant" | "flagged" | "pending" | "empty";

export type WaypointDot = {
  key: string; // `${trenchId}-${index}`
  trenchId: string;
  index: number;
  lat: number;
  lng: number;
  fcpId: string | null;
};

const WP_COLORS: Record<WaypointStatus, string> = {
  compliant: "#22c55e",
  flagged: "#ef4444",
  pending: "#f59e0b",
  empty: "#64748b",
};

// Drilldown UX: nothing per-waypoint is rendered until the worker picks
// a zone (FCP) and then a trench. Keeps the map fast and intentional.

function fcpIcon(name: string, count: number, selected = false) {
  const accent = selected ? "#f59e0b" : "#6366f1";
  const html = `
    <div style="
      min-width:54px;padding:4px 8px;border-radius:14px;
      background:#13131a;border:2px solid ${accent};
      box-shadow:0 0 14px ${accent}99;
      color:#fff;font-family:Inter,sans-serif;
      font-size:11px;line-height:1.1;text-align:center;
      cursor:pointer;
    ">
      <div style="font-weight:700">${name}</div>
      <div style="opacity:.7;font-size:10px">${count} segments</div>
    </div>`;
  return L.divIcon({ html, className: "", iconSize: [54, 30], iconAnchor: [27, 15] });
}

function userIcon() {
  return L.divIcon({
    html: `<div style="width:18px;height:18px;border-radius:50%;background:#6366f1;border:3px solid #fff;box-shadow:0 0 16px #6366f1;"></div>`,
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function FitToSite({ site }: { site: SiteData }) {
  const map = useMap();
  useEffect(() => {
    if (site.siteRing && site.siteRing.length) {
      const b = L.latLngBounds(site.siteRing.map(([lng, lat]) => [lat, lng]));
      map.fitBounds(b, { padding: [30, 30] });
    } else if (site.fcps.length) {
      const b = L.latLngBounds(site.fcps.map((f) => [f.lat, f.lng]));
      map.fitBounds(b, { padding: [50, 50] });
    }
  }, [map, site]);
  return null;
}

// Trailing-throttled viewport tracker — one state update per gesture.
function ViewportTracker({
  onChange,
}: {
  onChange: (state: { bounds: L.LatLngBounds; zoom: number }) => void;
}) {
  const map = useMap();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onChange({ bounds: map.getBounds(), zoom: map.getZoom() });
    }, 150);
  };

  useEffect(() => {
    onChange({ bounds: map.getBounds(), zoom: map.getZoom() });
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useMapEvents({
    moveend: fire,
    zoomend: fire,
  });
  return null;
}

type TrenchSummary = {
  trench: Trench;
  lat: number;
  lng: number;
  status: WaypointStatus;
  count: number;
  total: number;
};

function summarizeTrenches(
  site: SiteData,
  waypoints: WaypointDot[],
  statusByKey: Map<string, WaypointStatus>,
): TrenchSummary[] {
  const byTrench = new Map<string, WaypointDot[]>();
  for (const w of waypoints) {
    const arr = byTrench.get(w.trenchId);
    if (arr) arr.push(w);
    else byTrench.set(w.trenchId, [w]);
  }
  const rank = (s: WaypointStatus) =>
    s === "flagged" ? 3 : s === "pending" ? 2 : s === "compliant" ? 1 : 0;
  const out: TrenchSummary[] = [];
  for (const t of site.trenches) {
    const wps = byTrench.get(t.id);
    if (!wps || wps.length === 0) continue;
    let worst: WaypointStatus = "empty";
    let captured = 0;
    for (const w of wps) {
      const s = statusByKey.get(w.key) ?? "empty";
      if (s !== "empty") captured++;
      if (rank(s) > rank(worst)) worst = s;
    }
    const mid = wps[Math.floor(wps.length / 2)];
    out.push({
      trench: t,
      lat: mid.lat,
      lng: mid.lng,
      status: worst,
      count: captured,
      total: wps.length,
    });
  }
  return out;
}

export function WorkerSiteMap({
  site,
  user,
  onFcpTap,
  onTrenchTap,
  selectedFcpId,
  selectedTrenchId,
}: {
  site: SiteData;
  user: { lat: number; lng: number; accuracy: number } | null;
  onFcpTap: (fcp: FCP) => void;
  onTrenchTap?: (trench: Trench) => void;
  selectedFcpId?: string | null;
  selectedTrenchId?: string | null;
}) {
  const center: [number, number] = useMemo(() => {
    if (site.fcps.length) return [site.fcps[0].lat, site.fcps[0].lng];
    return [46.557, 14.291];
  }, [site]);

  const [, setView] = useState<{
    bounds: L.LatLngBounds | null;
    zoom: number;
  }>({ bounds: null, zoom: 16 });

  const renderer = useMemo(() => L.canvas({ padding: 0.1 }), []);

  const fcpById = useMemo(() => {
    const m = new Map<string, FCP>();
    for (const f of site.fcps) m.set(f.id, f);
    return m;
  }, [site]);

  return (
    <MapContainer
      center={center}
      zoom={16}
      style={{ height: "100%", width: "100%", background: "#0a0a0f" }}
      zoomControl={false}
      preferCanvas
      renderer={renderer}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
      />

      <ViewportTracker onChange={setView} />

      {site.siteRing && (
        <Polygon
          positions={site.siteRing.map(([lng, lat]) => [lat, lng] as [number, number])}
          pathOptions={{ color: "#6366f1", weight: 2, fillOpacity: 0.04, dashArray: "4 6" }}
        />
      )}

      {site.fcpPolygons.map((p, i) => {
        const isSelected = selectedFcpId && p.fcpId === selectedFcpId;
        const dim = selectedFcpId && !isSelected;
        return (
          <Polygon
            key={i}
            positions={p.ring.map(([lng, lat]) => [lat, lng] as [number, number])}
            pathOptions={{
              color: isSelected ? "#f59e0b" : "#22c55e",
              fillColor: isSelected ? "#f59e0b" : "#22c55e",
              weight: isSelected ? 3 : 1,
              fillOpacity: dim ? 0.02 : isSelected ? 0.25 : 0.06,
            }}
            eventHandlers={{
              click: () => {
                const fcp = fcpById.get(p.fcpId);
                if (fcp) onFcpTap(fcp);
              },
            }}
          />
        );
      })}

      {site.trenches.map((t) => {
        const inSelectedZone = selectedFcpId && t.fcpId === selectedFcpId;
        const isSelectedTrench = selectedTrenchId && t.id === selectedTrenchId;
        const dim = selectedFcpId && !inSelectedZone;
        return (
          <Polyline
            key={t.id}
            positions={t.coords.map(([lng, lat]) => [lat, lng] as [number, number])}
            pathOptions={{
              color: isSelectedTrench ? "#ffffff" : t.color,
              weight: isSelectedTrench ? 6 : inSelectedZone ? 5 : 4,
              opacity: dim ? 0.25 : 0.95,
            }}
            eventHandlers={{
              click: () => {
                if (inSelectedZone && onTrenchTap) {
                  onTrenchTap(t);
                } else {
                  const fcp = t.fcpId ? fcpById.get(t.fcpId) : undefined;
                  if (fcp) onFcpTap(fcp);
                }
              },
            }}
          />
        );
      })}



      {site.fcps.map((fcp) => {
        const total = site.trenchesByFcp[fcp.id]?.length ?? 0;
        return (
          <Marker
            key={fcp.id}
            position={[fcp.lat, fcp.lng]}
            icon={fcpIcon(fcp.id, total, selectedFcpId === fcp.id)}
            eventHandlers={{ click: () => onFcpTap(fcp) }}
          />
        );
      })}

      {user && (
        <>
          <Circle
            center={[user.lat, user.lng]}
            radius={user.accuracy}
            pathOptions={{ color: "#6366f1", fillColor: "#6366f1", fillOpacity: 0.1, weight: 1 }}
          />
          <Marker position={[user.lat, user.lng]} icon={userIcon()} />
        </>
      )}

      <FitToSite site={site} />
    </MapContainer>
  );
}
