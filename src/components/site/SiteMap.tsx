import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Polygon, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import type { ProjectData, ProjectFCP } from "@/lib/project-data";

function fcpIcon(name: string, count: number) {
  const html = `
    <div style="
      min-width:54px;padding:4px 8px;border-radius:14px;
      background:#13131a;border:2px solid #6366f1;
      box-shadow:0 0 14px rgba(99,102,241,.55);
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

function FitToSite({ site }: { site: ProjectData }) {
  const map = useMap();
  useEffect(() => {
    const pts = site.fcps
      .filter((f) => f.lat != null && f.lng != null)
      .map((f) => [f.lat!, f.lng!] as [number, number]);
    if (pts.length) {
      const b = L.latLngBounds(pts);
      map.fitBounds(b, { padding: [50, 50] });
    }
  }, [map, site]);
  return null;
}

export function SiteMap({
  site,
  user,
  onFcpTap,
  doneCounts,
}: {
  site: ProjectData;
  user: { lat: number; lng: number; accuracy: number } | null;
  onFcpTap: (fcp: ProjectFCP) => void;
  doneCounts: Record<string, number>;
}) {
  const center: [number, number] = useMemo(() => {
    const first = site.fcps.find((f) => f.lat != null && f.lng != null);
    if (first) return [first.lat!, first.lng!];
    return [46.557, 14.291];
  }, [site]);

  return (
    <MapContainer
      center={center}
      zoom={16}
      style={{ height: "100%", width: "100%", background: "#0a0a0f" }}
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
      />

      {Object.entries(site.fcpPolygons).map(([fcpId, ring]) => (
        <Polygon
          key={fcpId}
          positions={ring} // already [lat, lng]
          pathOptions={{ color: "#22c55e", weight: 1, fillOpacity: 0.06 }}
        />
      ))}

      {site.trenches.map((t, i) => {
        const fcpId = Object.keys(site.trenchesByFcp).find((k) =>
          site.trenchesByFcp[k].some((tr) => tr.id === t.id),
        );
        return (
          <Polyline
            key={i}
            positions={t.geometry} // already [lat, lng]
            pathOptions={{ color: t.fillColor ?? "#6366f1", weight: 4, opacity: 0.9 }}
            eventHandlers={{
              click: () => {
                const fcp = site.fcps.find((f) => f.id === fcpId);
                if (fcp) onFcpTap(fcp);
              },
            }}
          />
        );
      })}

      {site.fcps
        .filter((fcp) => fcp.lat != null && fcp.lng != null)
        .map((fcp) => {
          const total = site.trenchesByFcp[fcp.id]?.length ?? 0;
          return (
            <Marker
              key={fcp.id}
              position={[fcp.lat!, fcp.lng!]}
              icon={fcpIcon(fcp.name || fcp.id.slice(0, 8), total)}
              eventHandlers={{ click: () => onFcpTap(fcp) }}
            />
          );
        })}

      {user && <Marker position={[user.lat, user.lng]} icon={userIcon()} />}

      <FitToSite site={site} />
    </MapContainer>
  );
}
