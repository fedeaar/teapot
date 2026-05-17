import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Circle, CircleMarker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";

function userIcon() {
  return L.divIcon({
    html: `<div style="width:12px;height:12px;border-radius:50%;background:#6366f1;border:2px solid #fff;box-shadow:0 0 10px #6366f1;"></div>`,
    className: "",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

function FitBoth({
  target,
  user,
}: {
  target: { lat: number; lng: number };
  user: { lat: number; lng: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (user) {
      const b = L.latLngBounds([
        [target.lat, target.lng],
        [user.lat, user.lng],
      ]);
      map.fitBounds(b, { padding: [20, 20], maxZoom: 19 });
    } else {
      map.setView([target.lat, target.lng], 18);
    }
  }, [map, target.lat, target.lng, user?.lat, user?.lng]);
  return null;
}

export function CaptureMiniMap({
  target,
  user,
}: {
  target: { lat: number; lng: number };
  user: { lat: number; lng: number; accuracy: number } | null;
}) {
  const renderer = useMemo(() => L.canvas({ padding: 0.1 }), []);
  return (
    <MapContainer
      center={[target.lat, target.lng]}
      zoom={18}
      style={{ height: "100%", width: "100%", background: "#0a0a0f" }}
      zoomControl={false}
      attributionControl={false}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      boxZoom={false}
      keyboard={false}
      preferCanvas
      renderer={renderer}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png" />
      <CircleMarker
        center={[target.lat, target.lng]}
        radius={7}
        pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#f59e0b", fillOpacity: 1 }}
      />
      {user && (
        <>
          <Circle
            center={[user.lat, user.lng]}
            radius={user.accuracy}
            pathOptions={{ color: "#6366f1", fillColor: "#6366f1", fillOpacity: 0.15, weight: 1 }}
          />
          <Marker position={[user.lat, user.lng]} icon={userIcon()} />
          <Polyline
            positions={[
              [user.lat, user.lng],
              [target.lat, target.lng],
            ]}
            pathOptions={{ color: "#ffffff", weight: 1.5, opacity: 0.6, dashArray: "4 4" }}
          />
        </>
      )}
      <FitBoth target={target} user={user} />
    </MapContainer>
  );
}
