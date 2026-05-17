// Loader + parser for the construction site GeoJSON.
// Files are served statically from /site/*.geojson.

export type LngLat = [number, number]; // [lng, lat] (geojson order)

export type FCP = {
  id: string;            // fcpName e.g. "F012"
  externalId: string;
  lng: number;
  lat: number;
  district?: string;
  address?: string;
};

export type FCPPolygon = {
  fcpId: string;          // matched by name (best-effort)
  externalId: string;
  ring: LngLat[];         // outer ring
};

export type Trench = {
  id: string;             // externalID
  label: string;
  state: string;
  color: string;          // hex
  coords: LngLat[];       // LineString
  fcpId: string | null;   // precomputed FCP assignment
};

export type SiteData = {
  fcps: FCP[];
  fcpPolygons: FCPPolygon[];
  trenches: Trench[];
  siteRing: LngLat[] | null;
  trenchesByFcp: Record<string, Trench[]>;
};

let cache: Promise<SiteData> | null = null;

export function loadSiteData(): Promise<SiteData> {
  if (cache) return cache;
  cache = (async () => {
    const [trenchRaw, fcpsRaw, polysRaw, siteRaw] = await Promise.all([
      fetch("/site/trenches.geojson").then((r) => r.json()),
      fetch("/site/fcps.geojson").then((r) => r.json()),
      fetch("/site/fcp-polygons.geojson").then((r) => r.json()),
      fetch("/site/site-cluster.geojson").then((r) => r.json()),
    ]);

    const fcps: FCP[] = (fcpsRaw.features ?? []).map((f: any) => ({
      id: f.properties.fcpName,
      externalId: f.properties.externalID,
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      district: f.properties.district,
      address: f.properties.address,
    }));

    // Match polygons to FCPs by checking which FCP point falls inside each polygon.
    const fcpPolygons: FCPPolygon[] = (polysRaw.features ?? []).map((f: any) => {
      const ring: LngLat[] = f.geometry.coordinates[0];
      const inside = fcps.find((fcp) => pointInRing([fcp.lng, fcp.lat], ring));
      return {
        fcpId: inside?.id ?? f.properties.userLabel ?? f.properties.name ?? "?",
        externalId: f.properties.externalID,
        ring,
      };
    });

    const trenches: Trench[] = (trenchRaw.features ?? []).map((f: any) => ({
      id: f.properties.externalID,
      label: f.properties.userLabel ?? "",
      state: f.properties.executionState ?? "",
      color: f.properties.fillColor ?? "#6366f1",
      coords: f.geometry.coordinates as LngLat[],
      fcpId: null as string | null,
    }));

    const siteRing: LngLat[] | null =
      siteRaw.features?.[0]?.geometry?.coordinates?.[0] ?? null;

    // Group trenches: assign each to the FCP polygon containing its midpoint.
    const trenchesByFcp: Record<string, Trench[]> = {};
    for (const fcp of fcps) trenchesByFcp[fcp.id] = [];
    for (const t of trenches) {
      const mid = midpoint(t.coords);
      const poly = fcpPolygons.find((p) => pointInRing(mid, p.ring));
      if (poly && trenchesByFcp[poly.fcpId]) {
        t.fcpId = poly.fcpId;
        trenchesByFcp[poly.fcpId].push(t);
      }
    }

    return { fcps, fcpPolygons, trenches, siteRing, trenchesByFcp };
  })();
  return cache;
}

function midpoint(coords: LngLat[]): LngLat {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1) return coords[0];
  return coords[Math.floor(coords.length / 2)];
}

// Ray-casting point-in-polygon. Polygon is a closed ring of [lng,lat] pairs.
export function pointInRing(pt: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
