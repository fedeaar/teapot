import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Circle, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import type { ProjectTrench } from "@/lib/project-data";
import { pointsAlongTrench } from "@/lib/geo";

export type PhotoDot = {
  id: string;
  lat: number;
  lng: number;
  status: "compliant" | "flagged" | "pending";
};

export type Waypoint = { index: number; lat: number; lng: number };

const PHOTO_COLORS = {
  compliant: "#22c55e",
  flagged: "#ef4444",
  pending: "#f59e0b",
} as const;

function photoIcon(status: PhotoDot["status"]) {
  const c = PHOTO_COLORS[status];
  return L.divIcon({
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${c};border:2px solid #0a0a0f;box-shadow:0 0 8px ${c};"></div>`,
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function userIcon() {
  return L.divIcon({
    html: `<div style="width:18px;height:18px;border-radius:50%;background:#6366f1;border:3px solid #fff;box-shadow:0 0 16px #6366f1;"></div>`,
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function waypointIcon(index: number, done: boolean) {
  const bg = done ? "#22c55e" : "#6366f1";
  const glow = done ? "#22c55e" : "#6366f1";
  return L.divIcon({
    html: `<div style="
      width:22px;height:22px;border-radius:50%;
      background:${bg};border:2px solid #fff;
      box-shadow:0 0 12px ${glow};
      color:#fff;font:600 10px Inter,sans-serif;
      display:flex;align-items:center;justify-content:center;
      cursor:pointer;
    ">${index + 1}</div>`,
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function FitBounds({ trenches }: { trenches: ProjectTrench[] }) {
  const map = useMap();
  useEffect(() => {
    const all: [number, number][] = [];
    for (const t of trenches) for (const c of t.geometry) all.push(c); // already [lat, lng]
    if (all.length < 2) return;
    map.fitBounds(L.latLngBounds(all), { padding: [40, 40] });
  }, [map, trenches]);
  return null;
}

export function ZoneMap({
  trenches,
  photos,
  user,
  selectedTrenchId,
  onTrenchSelect,
  onWaypointTap,
  onPhotoTap,
}: {
  trenches: ProjectTrench[];
  photos: PhotoDot[];
  user: { lat: number; lng: number; accuracy: number } | null;
  selectedTrenchId: string | null;
  onTrenchSelect: (trenchId: string) => void;
  onWaypointTap: (w: { trenchId: string; index: number; lat: number; lng: number }) => void;
  onPhotoTap?: (id: string) => void;
}) {
  const center: [number, number] = useMemo(() => {
    if (trenches.length && trenches[0].geometry.length) {
      return trenches[0].geometry[0]; // already [lat, lng]
    }
    return [46.557, 14.291] as [number, number];
  }, [trenches]);

  const selected = trenches.find((t) => t.id === selectedTrenchId) ?? null;
  const waypoints: Waypoint[] = useMemo(() => {
    if (!selected) return [];
    // Convert [lat, lng] to [lng, lat] for pointsAlongTrench
    const coordsLngLat = selected.geometry.map(([lat, lng]) => [lng, lat] as [number, number]);
    return pointsAlongTrench(coordsLngLat, 5);
  }, [selected]);

  return (
    <MapContainer
      center={center}
      zoom={19}
      style={{ height: "100%", width: "100%", background: "#0a0a0f" }}
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
      />
      {trenches.map((t) => {
        const isSel = t.id === selectedTrenchId;
        return (
          <Polyline
            key={t.id}
            positions={t.geometry} // already [lat, lng]
            pathOptions={{
              color: isSel ? "#fbbf24" : t.fillColor || "#6366f1",
              weight: isSel ? 6 : 4,
              opacity: isSel ? 1 : 0.85,
            }}
            eventHandlers={{ click: () => onTrenchSelect(t.id) }}
          />
        );
      })}

      {waypoints.map((w) => (
        <Marker
          key={`${selected!.id}-${w.index}`}
          position={[w.lat, w.lng]}
          icon={waypointIcon(w.index, false)}
          eventHandlers={{
            click: () =>
              onWaypointTap({
                trenchId: selected!.id,
                index: w.index,
                lat: w.lat,
                lng: w.lng,
              }),
          }}
        />
      ))}

      {photos.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={photoIcon(p.status)}
          eventHandlers={onPhotoTap ? { click: () => onPhotoTap(p.id) } : undefined}
        />
      ))}

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

      <FitBounds trenches={trenches} />
    </MapContainer>
  );
}

export type { PhotoDot as ZonePhotoDot };
