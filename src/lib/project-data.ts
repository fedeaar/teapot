// Loader for project geometry from Supabase.
// Replaces the old site-data.ts which loaded static GeoJSON files.

import { supabase } from "@/integrations/supabase/client";

// --- Types ---

export type ProjectCluster = {
  id: string;
  name: string;
  geometry: [number, number][] | null; // polygon coords [lat, lng]
  lat: number | null;
  lng: number | null;
};

export type ProjectFCP = {
  id: string; // uuid
  name: string; // fcp_name
  externalId: string | null;
  clusterId: string | null;
  lat: number | null;
  lng: number | null;
  polygon: [number, number][] | null; // from polygon_geometry
  fillColor: string | null;
  address: string | null;
};

export type ProjectTrench = {
  id: string; // uuid
  name: string | null;
  externalId: string | null;
  clusterId: string | null;
  geometry: [number, number][]; // LineString coords [lat, lng]
  lengthM: number | null;
  fillColor: string | null;
  executionState: string | null;
};

export type ProjectData = {
  clusters: ProjectCluster[];
  fcps: ProjectFCP[];
  trenches: ProjectTrench[];
  trenchesByFcp: Record<string, ProjectTrench[]>; // keyed by fcp id
  fcpPolygons: Record<string, [number, number][]>; // keyed by fcp id
};

// --- GeoJSON parsing helpers ---
// GeoJSON uses [lng, lat]; we convert to [lat, lng] for Leaflet.

function parsePoint(geojson: any): [number, number] | null {
  if (!geojson || geojson.type !== "Point" || !Array.isArray(geojson.coordinates)) return null;
  const [lng, lat] = geojson.coordinates;
  return [lat, lng];
}

function parseLineString(geojson: any): [number, number][] {
  if (!geojson || geojson.type !== "LineString" || !Array.isArray(geojson.coordinates)) return [];
  return geojson.coordinates.map(([lng, lat]: [number, number]) => [lat, lng] as [number, number]);
}

function parsePolygon(geojson: any): [number, number][] | null {
  if (!geojson || geojson.type !== "Polygon" || !Array.isArray(geojson.coordinates)) return null;
  const outerRing = geojson.coordinates[0];
  if (!Array.isArray(outerRing)) return null;
  return outerRing.map(([lng, lat]: [number, number]) => [lat, lng] as [number, number]);
}

// --- Geometry utilities ---

function midpoint(coords: [number, number][]): [number, number] {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1) return coords[0];
  return coords[Math.floor(coords.length / 2)];
}

/** Ray-casting point-in-polygon. Points are [lat, lng]. */
function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
  const px = pt[1], py = pt[0]; // lng = x, lat = y
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1], yi = ring[i][0]; // lng = x, lat = y
    const xj = ring[j][1], yj = ring[j][0];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// --- Paginated fetch helper ---

async function fetchAll<T>(
  table: "site_clusters" | "fcps" | "trenches" | "images",
  select: string,
  projectId: string,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq("project_id", projectId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to load ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// --- Main loader ---

export async function loadProjectData(projectId: string): Promise<ProjectData> {
  // Load clusters, FCPs and trenches in parallel (paginated)
  const [clusterRows, fcpRows, trenchRows] = await Promise.all([
    fetchAll<any>("site_clusters", "id, cluster_name, geometry, lat, lng", projectId),
    fetchAll<any>("fcps", "id, fcp_name, external_id, cluster_id, lat, lng, polygon_geometry, fill_color, address", projectId),
    fetchAll<any>("trenches", "id, name, external_id, cluster_id, geometry, length_m, fill_color, execution_state", projectId),
  ]);

  const clusters: ProjectCluster[] = clusterRows.map((c: any) => ({
    id: c.id,
    name: c.cluster_name ?? "",
    geometry: parsePolygon(c.geometry),
    lat: c.lat,
    lng: c.lng,
  }));
  const fcps: ProjectFCP[] = fcpRows.map((f: any) => ({
    id: f.id,
    name: f.fcp_name ?? "",
    externalId: f.external_id,
    clusterId: f.cluster_id,
    lat: f.lat,
    lng: f.lng,
    polygon: parsePolygon(f.polygon_geometry),
    fillColor: f.fill_color,
    address: f.address ?? null,
  }));

  const trenches: ProjectTrench[] = trenchRows.map((t: any) => ({
    id: t.id,
    name: t.name,
    externalId: t.external_id,
    clusterId: t.cluster_id,
    geometry: parseLineString(t.geometry),
    lengthM: t.length_m,
    fillColor: t.fill_color,
    executionState: t.execution_state,
  }));

  // 3. Build fcpPolygons lookup
  const fcpPolygons: Record<string, [number, number][]> = {};
  for (const fcp of fcps) {
    if (fcp.polygon) {
      fcpPolygons[fcp.id] = fcp.polygon;
    }
  }

  // 4. Group trenches by FCP — assign each trench to the FCP polygon containing its midpoint
  const trenchesByFcp: Record<string, ProjectTrench[]> = {};
  for (const fcp of fcps) {
    trenchesByFcp[fcp.id] = [];
  }
  const fcpsWithPolygon = fcps.filter((f) => f.polygon != null);
  for (const t of trenches) {
    if (t.geometry.length === 0) continue;
    const mid = midpoint(t.geometry);
    const matchedFcp = fcpsWithPolygon.find((fcp) => pointInRing(mid, fcp.polygon!));
    if (matchedFcp) {
      trenchesByFcp[matchedFcp.id].push(t);
    }
  }

  return { clusters, fcps, trenches, trenchesByFcp, fcpPolygons };
}
