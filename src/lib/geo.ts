export type LatLng = { lat: number; lng: number };

const R = 6371000; // earth radius (m)

export function haversine(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Project lat/lng to a local equirectangular meter plane around an anchor.
function toMeters(p: LatLng, anchor: LatLng): { x: number; y: number } {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const x = (toRad(p.lng - anchor.lng)) * Math.cos(toRad(anchor.lat)) * R;
  const y = toRad(p.lat - anchor.lat) * R;
  return { x, y };
}

function fromMeters(m: { x: number; y: number }, anchor: LatLng): LatLng {
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat = anchor.lat + toDeg(m.y / R);
  const lng = anchor.lng + toDeg(m.x / (R * Math.cos((anchor.lat * Math.PI) / 180)));
  return { lat, lng };
}

/**
 * Project `pt` onto the closest point of any trench polyline (LineString).
 * Returns the snapped point, distance in meters, and which trench it hit.
 * trenches are arrays of [lng, lat] pairs.
 */
export function nearestPointOnTrenches(
  pt: LatLng,
  trenches: { id: string; coords: [number, number][] }[],
): { lat: number; lng: number; distanceM: number; trenchId: string } | null {
  let best: { lat: number; lng: number; distanceM: number; trenchId: string } | null = null;
  const p = toMeters(pt, pt);

  for (const t of trenches) {
    for (let i = 0; i < t.coords.length - 1; i++) {
      const a = toMeters({ lat: t.coords[i][1], lng: t.coords[i][0] }, pt);
      const b = toMeters({ lat: t.coords[i + 1][1], lng: t.coords[i + 1][0] }, pt);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let tParam = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      tParam = Math.max(0, Math.min(1, tParam));
      const sx = a.x + tParam * dx;
      const sy = a.y + tParam * dy;
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (!best || d < best.distanceM) {
        const ll = fromMeters({ x: sx, y: sy }, pt);
        best = { lat: ll.lat, lng: ll.lng, distanceM: d, trenchId: t.id };
      }
    }
  }
  return best;
}

/**
 * Generate evenly-spaced waypoints along a polyline (coords as [lng,lat]).
 * Spacing in meters. Includes start and end (end only if >0.5*spacing from last).
 */
export function pointsAlongTrench(
  coords: [number, number][],
  spacingM: number,
): { lat: number; lng: number; index: number }[] {
  if (coords.length < 2) return [];
  const anchor: LatLng = { lat: coords[0][1], lng: coords[0][0] };
  const projected = coords.map((c) => toMeters({ lat: c[1], lng: c[0] }, anchor));
  const out: { lat: number; lng: number; index: number }[] = [];
  let carry = 0;
  let idx = 0;
  out.push({ lat: anchor.lat, lng: anchor.lng, index: idx++ });
  for (let i = 0; i < projected.length - 1; i++) {
    const a = projected[i];
    const b = projected[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const seg = Math.hypot(dx, dy);
    let dist = spacingM - carry;
    while (dist <= seg) {
      const t = dist / seg;
      const ll = fromMeters({ x: a.x + t * dx, y: a.y + t * dy }, anchor);
      out.push({ lat: ll.lat, lng: ll.lng, index: idx++ });
      dist += spacingM;
    }
    carry = seg - (dist - spacingM);
  }
  const last = projected[projected.length - 1];
  const lastLL = fromMeters(last, anchor);
  const lastOut = out[out.length - 1];
  const dEnd = Math.hypot(
    last.x - toMeters(lastOut, anchor).x,
    last.y - toMeters(lastOut, anchor).y,
  );
  if (dEnd > spacingM * 0.5) out.push({ lat: lastLL.lat, lng: lastLL.lng, index: idx++ });
  return out;
}

export function trenchLength(coords: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += haversine(
      { lat: coords[i][1], lng: coords[i][0] },
      { lat: coords[i + 1][1], lng: coords[i + 1][0] },
    );
  }
  return total;
}
