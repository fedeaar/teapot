// Pure functions: given a lat/lng and the loaded ProjectData, decide which
// FCP polygon, trench, and 5 m waypoint the photo belongs to, plus a status
// based on how close to a waypoint it lands. No I/O — easy to unit-test.

import { haversine, nearestPointOnTrenches, pointsAlongTrench, type LatLng } from "./geo";
import type { ProjectData, ProjectTrench } from "./project-data";

// Waypoints are placed every 5 m along each trench.
export const WAYPOINT_SPACING_M = 5;
// Photos must be within 0.5 m of a waypoint to count as a clean match.
export const WAYPOINT_OK_M = 5;
// Anything past 15 m from the nearest trench is off-site.
export const WAYPOINT_FLAG_M = 15;

// True when the matcher concluded the photo is not on the construction
// site (no FCP, no trench, no waypoint, or beyond WAYPOINT_FLAG_M from any
// trench). Used to gate the AI compliance call: scoring an off-site photo
// is meaningless and wastes a model call.
const OFF_SITE_TAGS = new Set(["off_site", "no_trench", "no_waypoint"]);
export function isOffSite(issues: readonly string[]): boolean {
  return issues.some((i) => OFF_SITE_TAGS.has(i) || i.startsWith("off_site:"));
}

export type PhotoMatch = {
  fcpId: string | null;
  trenchId: string | null;
  clusterId: string | null;
  waypointIndex: number | null;
  // Snapped waypoint coordinates if a waypoint was matched, useful for UI.
  waypointLat: number | null;
  waypointLng: number | null;
  distanceToWaypointM: number | null;
  status: "pending" | "flagged";
  issues: string[];
};

/** Convert [lat, lng] coords (ProjectData format) to [lng, lat] (geo.ts format). */
function toGeoCoords(latLngPairs: [number, number][]): [number, number][] {
  return latLngPairs.map(([lat, lng]) => [lng, lat]);
}

/** Adapt a ProjectTrench to the shape expected by geo.ts functions. */
function trenchToGeo(t: ProjectTrench): { id: string; coords: [number, number][] } {
  return { id: t.id, coords: toGeoCoords(t.geometry) };
}

/** Ray-casting point-in-polygon. Ring is [lat, lng] pairs (ProjectData format). */
function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
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

function nearestWaypoint(
  pt: LatLng,
  trench: ProjectTrench,
): {
  index: number;
  lat: number;
  lng: number;
  distanceM: number;
} | null {
  // pointsAlongTrench expects [lng, lat] coords
  const waypoints = pointsAlongTrench(toGeoCoords(trench.geometry), WAYPOINT_SPACING_M);
  if (waypoints.length === 0) return null;
  let best = waypoints[0];
  let bestD = haversine(pt, best);
  for (let i = 1; i < waypoints.length; i++) {
    const d = haversine(pt, waypoints[i]);
    if (d < bestD) {
      bestD = d;
      best = waypoints[i];
    }
  }
  return { index: best.index, lat: best.lat, lng: best.lng, distanceM: bestD };
}

export function matchPhotoToWaypoint(pt: LatLng, project: ProjectData): PhotoMatch {
  // 1. Find the FCP polygon (if any) containing the photo.
  //    fcpPolygons values are [lat, lng][] — pointInRing uses [lat, lng] order.
  let fcpId: string | null = null;
  for (const [id, ring] of Object.entries(project.fcpPolygons)) {
    if (pointInRing([pt.lat, pt.lng], ring)) {
      fcpId = id;
      break;
    }
  }

  // Look up the clusterId from the matched FCP.
  const matchedFcp = fcpId ? project.fcps.find((f) => f.id === fcpId) : null;
  const clusterId = matchedFcp?.clusterId ?? null;

  // 2. Pick the candidate set of trenches. If the photo is inside an FCP, only
  //    consider its trenches; otherwise fall back to all trenches so we can
  //    still flag the closest one.
  const candidates =
    fcpId && project.trenchesByFcp[fcpId] && project.trenchesByFcp[fcpId].length > 0
      ? project.trenchesByFcp[fcpId]
      : project.trenches;

  // nearestPointOnTrenches expects { id, coords: [lng, lat][] }
  const snapped = nearestPointOnTrenches(pt, candidates.map(trenchToGeo));
  if (!snapped) {
    return {
      fcpId,
      trenchId: null,
      clusterId,
      waypointIndex: null,
      waypointLat: null,
      waypointLng: null,
      distanceToWaypointM: null,
      status: "flagged",
      issues: ["no_trench"],
    };
  }

  const trench = candidates.find((t) => t.id === snapped.trenchId) ?? null;
  if (!trench) {
    return {
      fcpId,
      trenchId: null,
      clusterId,
      waypointIndex: null,
      waypointLat: null,
      waypointLng: null,
      distanceToWaypointM: null,
      status: "flagged",
      issues: ["no_trench"],
    };
  }

  const wp = nearestWaypoint(pt, trench);
  if (!wp) {
    return {
      fcpId,
      trenchId: trench.id,
      clusterId,
      waypointIndex: null,
      waypointLat: null,
      waypointLng: null,
      distanceToWaypointM: null,
      status: "flagged",
      issues: ["no_waypoint"],
    };
  }

  // 3. Decide status based on how close to the waypoint we landed.
  const issues: string[] = [];
  let status: "pending" | "flagged" = "pending";

  if (!fcpId) {
    issues.push("off_site");
    status = "flagged";
  }

  if (wp.distanceM > WAYPOINT_FLAG_M) {
    status = "flagged";
    issues.push(`off_site:${Math.round(wp.distanceM)}m`);
    return {
      fcpId,
      trenchId: null,
      clusterId,
      waypointIndex: null,
      waypointLat: null,
      waypointLng: null,
      distanceToWaypointM: wp.distanceM,
      status,
      issues,
    };
  }

  if (wp.distanceM > WAYPOINT_OK_M) {
    status = "flagged";
    issues.push(`far_from_waypoint:${Math.round(wp.distanceM)}m`);
  }

  return {
    fcpId,
    trenchId: trench.id,
    clusterId,
    waypointIndex: wp.index,
    waypointLat: wp.lat,
    waypointLng: wp.lng,
    distanceToWaypointM: wp.distanceM,
    status,
    issues,
  };
}
