import type { ProjectData } from "@/lib/project-data";
import type { SiteData } from "@/lib/site-data";
import { pointsAlongTrench, trenchLength } from "@/lib/geo";
import { METERS_PER_PHOTO } from "@/lib/validate-photo.functions";

export type TrenchStatus = "green" | "yellow" | "red";

export type PhotoLite = {
  fcp_id: string | null;
  trench_id?: string | null;
  waypoint_index?: number | null;
  status: string | null; // 'compliant' | 'needs_review' | 'flagged' | 'pending' | 'irrelevant'
  verdict?: string | null; // 'green' | 'yellow' | 'red' (legacy: 'compliant' | 'non_compliant' | 'needs_review')
};

/**
 * Normalize a photo's verdict / status fields into the 3-class traffic-light
 * model. Returns null when the photo hasn't been classified yet (pending /
 * unknown). Accepts both the new verdict strings ("green"/"yellow"/"red")
 * and the legacy values ("compliant"/"non_compliant"/"needs_review").
 */
export function photoClass(photo: PhotoLite): TrenchStatus | null {
  const v = photo.verdict;
  if (v === "green" || v === "compliant") return "green";
  if (v === "yellow" || v === "needs_review") return "yellow";
  if (v === "red" || v === "non_compliant") return "red";
  // Fall back to status for rows that never got a verdict.
  if (photo.status === "compliant") return "green";
  if (photo.status === "needs_review") return "yellow";
  if (photo.status === "flagged") return "yellow";
  if (photo.status === "irrelevant") return "red";
  return null;
}

export type CoverageResult = {
  trenchStatus: Record<string, TrenchStatus>; // trench id -> status
  zoneStatus: Record<string, TrenchStatus>; // fcp id -> status
  zoneStats: Record<string, { needed: number; compliant: number; flagged: number; ratio: number }>;
  trenchStats: Record<
    string,
    {
      needed: number;
      compliant: number;
      flagged: number;
      pending: number;
      evidence: number;
      ratio: number;
    }
  >;
  totals: {
    greenM: number;
    yellowM: number;
    redM: number;
    totalM: number;
    greenPct: number;
    yellowPct: number;
    redPct: number;
  };
};

const SPACING_M = 5;

type CoverageSite = ProjectData | SiteData;
type CoverageTrench = CoverageSite["trenches"][number];

function trenchCoordsLngLat(trench: CoverageTrench): [number, number][] {
  if ("geometry" in trench) {
    return trench.geometry.map(([lat, lng]) => [lng, lat] as [number, number]);
  }
  return trench.coords;
}

function trenchState(trench: CoverageTrench): string | null {
  if ("executionState" in trench) return trench.executionState;
  return trench.state;
}

function photoIsCompliant(photo: PhotoLite): boolean {
  return photoClass(photo) === "green";
}

function photoIsFlagged(photo: PhotoLite): boolean {
  const c = photoClass(photo);
  return c === "red" || c === "yellow";
}

function majorityClass(photos: PhotoLite[]): TrenchStatus {
  let g = 0;
  let y = 0;
  let r = 0;
  for (const p of photos) {
    const c = photoClass(p);
    if (c === "green") g++;
    else if (c === "yellow") y++;
    else if (c === "red") r++;
  }
  if (g === 0 && y === 0 && r === 0) return "red";
  if (r >= y && r >= g) return "red";
  if (y >= g) return "yellow";
  return "green";
}

function statusFromEvidence(args: {
  needed: number;
  compliant: number;
  flagged: number;
  pending: number;
  executionState: string | null;
}): TrenchStatus {
  const hasOpenIssue = args.flagged > 0 || args.pending > 0;
  const executionState = args.executionState?.toLowerCase() ?? "";
  const nonDocumented = executionState !== "" && executionState !== "documented";

  if (args.compliant >= args.needed && !hasOpenIssue && !nonDocumented) return "green";
  if (args.compliant > 0 || hasOpenIssue) return "yellow";
  return "red";
}

function addLength(
  total: { greenM: number; yellowM: number; redM: number },
  status: TrenchStatus,
  meters: number,
) {
  if (status === "green") total.greenM += meters;
  else if (status === "yellow") total.yellowM += meters;
  else total.redM += meters;
}

export function computeCoverage(site: CoverageSite, photos: PhotoLite[]): CoverageResult {
  const photosByTrench = new Map<string, PhotoLite[]>();
  for (const p of photos) {
    if (!p.trench_id) continue;
    const list = photosByTrench.get(p.trench_id) ?? [];
    list.push(p);
    photosByTrench.set(p.trench_id, list);
  }

  // Photos grouped by zone for majority-class coloring on the overall map.
  const photosByZone = new Map<string, PhotoLite[]>();
  for (const p of photos) {
    if (!p.fcp_id) continue;
    const list = photosByZone.get(p.fcp_id) ?? [];
    list.push(p);
    photosByZone.set(p.fcp_id, list);
  }

  const zoneStats: CoverageResult["zoneStats"] = {};
  const zoneStatus: Record<string, TrenchStatus> = {};
  const trenchStatus: Record<string, TrenchStatus> = {};
  const trenchStats: CoverageResult["trenchStats"] = {};
  const totals = { greenM: 0, yellowM: 0, redM: 0 };
  const assigned = new Set<string>();

  for (const fcp of site.fcps) {
    const zoneTotals = { greenM: 0, yellowM: 0, redM: 0 };
    let needed = 0;
    let compliant = 0;
    let flagged = 0;

    for (const t of site.trenchesByFcp[fcp.id] ?? []) {
      assigned.add(t.id);
      const coords = trenchCoordsLngLat(t);
      const lengthM = "lengthM" in t && t.lengthM != null ? t.lengthM : trenchLength(coords);
      const waypointTotal = Math.max(1, pointsAlongTrench(coords, SPACING_M).length);
      const trenchPhotos = photosByTrench.get(t.id) ?? [];
      const compliantWaypoints = new Set(
        trenchPhotos
          .filter((photo) => photoIsCompliant(photo) && photo.waypoint_index != null)
          .map((photo) => photo.waypoint_index as number),
      );
      const flaggedPhotos = trenchPhotos.filter(photoIsFlagged).length;
      const pendingPhotos = trenchPhotos.filter((photo) => photo.status === "pending").length;
      const status = statusFromEvidence({
        needed: waypointTotal,
        compliant: compliantWaypoints.size,
        flagged: flaggedPhotos,
        pending: pendingPhotos,
        executionState: trenchState(t),
      });

      trenchStatus[t.id] = status;
      trenchStats[t.id] = {
        needed: waypointTotal,
        compliant: compliantWaypoints.size,
        flagged: flaggedPhotos,
        pending: pendingPhotos,
        evidence: trenchPhotos.length,
        ratio: compliantWaypoints.size / waypointTotal,
      };
      needed += waypointTotal;
      compliant += compliantWaypoints.size;
      flagged += flaggedPhotos;
      addLength(totals, status, lengthM);
      addLength(zoneTotals, status, lengthM);
    }

    const ratio = needed === 0 ? 0 : compliant / needed;
    zoneStats[fcp.id] = { needed, compliant, flagged, ratio };
    // Overall-view coloring: pick the class with the most photos in the zone.
    // Tie-break favours the worse class (red > yellow > green) so a 1-1 tie
    // surfaces the more cautious read. Empty zones stay red.
    zoneStatus[fcp.id] = majorityClass(photosByZone.get(fcp.id) ?? []);
  }

  // Trenches not assigned to any FCP zone are still classified by their own
  // waypoint evidence so imported geometry does not fail closed on grouping.
  for (const t of site.trenches) {
    if (assigned.has(t.id)) continue;
    const coords = trenchCoordsLngLat(t);
    const len = "lengthM" in t && t.lengthM != null ? t.lengthM : trenchLength(coords);
    const waypointTotal = Math.max(1, pointsAlongTrench(coords, SPACING_M).length);
    const trenchPhotos = photosByTrench.get(t.id) ?? [];
    const compliantWaypoints = new Set(
      trenchPhotos
        .filter((photo) => photoIsCompliant(photo) && photo.waypoint_index != null)
        .map((photo) => photo.waypoint_index as number),
    );
    const flaggedPhotos = trenchPhotos.filter(photoIsFlagged).length;
    const pendingPhotos = trenchPhotos.filter((photo) => photo.status === "pending").length;
    const status = statusFromEvidence({
      needed: waypointTotal,
      compliant: compliantWaypoints.size,
      flagged: flaggedPhotos,
      pending: pendingPhotos,
      executionState: trenchState(t),
    });

    trenchStatus[t.id] = status;
    trenchStats[t.id] = {
      needed: waypointTotal,
      compliant: compliantWaypoints.size,
      flagged: flaggedPhotos,
      pending: pendingPhotos,
      evidence: trenchPhotos.length,
      ratio: compliantWaypoints.size / waypointTotal,
    };
    addLength(totals, status, len);
  }

  // Photo-driven coverage — each classified photo represents METERS_PER_PHOTO
  // (10 m) of trench evidence at its assigned class. Red counts cover BOTH
  // photos classified red AND the undocumented remainder of the trench, so
  // greenPct + yellowPct + redPct always sums to 100 %.
  let greenPhotos = 0;
  let yellowPhotos = 0;
  for (const p of photos) {
    const c = photoClass(p);
    if (c === "green") greenPhotos++;
    else if (c === "yellow") yellowPhotos++;
  }
  const photoGreenM = greenPhotos * METERS_PER_PHOTO;
  const photoYellowM = yellowPhotos * METERS_PER_PHOTO;

  // Total trench length comes from the loaded geometry (sum of every
  // trench in this site). Red picks up everything that isn't green or yellow
  // — including undocumented length and length covered only by red photos.
  let geometryTotalM = 0;
  for (const t of site.trenches) {
    const coords = trenchCoordsLngLat(t);
    geometryTotalM += "lengthM" in t && t.lengthM != null ? t.lengthM : trenchLength(coords);
  }
  const totalM = Math.max(geometryTotalM, photoGreenM + photoYellowM, 1);
  const cappedGreenM = Math.min(photoGreenM, totalM);
  const cappedYellowM = Math.min(photoYellowM, totalM - cappedGreenM);
  const photoRedM = Math.max(0, totalM - cappedGreenM - cappedYellowM);
  const pct = (m: number) => (m / totalM) * 100;

  return {
    trenchStatus,
    zoneStatus,
    zoneStats,
    trenchStats,
    totals: {
      greenM: cappedGreenM,
      yellowM: cappedYellowM,
      redM: photoRedM,
      totalM: geometryTotalM,
      greenPct: pct(cappedGreenM),
      yellowPct: pct(cappedYellowM),
      redPct: pct(photoRedM),
    },
  };
}

// Build the colored sub-segments of a trench polyline based on photo coverage.
// Each photo with a waypoint_index paints a HALO_M-half halo (so 10 m total
// centered on the waypoint). Overlapping halos resolve in favour of the
// higher (more compliant) class: green > yellow > red. Stretches of the
// trench with no photo halo are omitted — the caller renders an uncolored
// base under these segments.
export function trenchColoredSegments(
  geometryLatLng: [number, number][],
  photos: Array<{ waypoint_index: number | null; class: TrenchStatus }>,
  options: { halfHaloM?: number; sampleSpacingM?: number; waypointSpacingM?: number } = {},
): Array<{ coords: [number, number][]; cls: TrenchStatus }> {
  const HALO = options.halfHaloM ?? 5;
  const SAMPLE = options.sampleSpacingM ?? 1;
  const WP = options.waypointSpacingM ?? 5;
  if (geometryLatLng.length < 2 || photos.length === 0) return [];

  const lngLat = geometryLatLng.map(
    ([lat, lng]) => [lng, lat] as [number, number],
  );
  const samples = pointsAlongTrench(lngLat, SAMPLE);
  if (samples.length === 0) return [];

  // Higher value = more compliant; ties keep first-set value (no swap).
  const rank: Record<TrenchStatus, number> = { red: 1, yellow: 2, green: 3 };
  const sampleClass: (TrenchStatus | null)[] = new Array(samples.length).fill(null);

  for (const p of photos) {
    if (p.waypoint_index == null) continue;
    const photoM = p.waypoint_index * WP;
    const lo = Math.max(0, Math.floor((photoM - HALO) / SAMPLE));
    const hi = Math.min(samples.length - 1, Math.ceil((photoM + HALO) / SAMPLE));
    for (let i = lo; i <= hi; i++) {
      const cur = sampleClass[i];
      if (!cur || rank[p.class] > rank[cur]) sampleClass[i] = p.class;
    }
  }

  const out: Array<{ coords: [number, number][]; cls: TrenchStatus }> = [];
  let i = 0;
  while (i < samples.length) {
    const cls = sampleClass[i];
    if (!cls) {
      i++;
      continue;
    }
    let j = i;
    while (j < samples.length && sampleClass[j] === cls) j++;
    const coords = samples
      .slice(i, j)
      .map((s) => [s.lat, s.lng] as [number, number]);
    if (coords.length >= 2) out.push({ coords, cls });
    i = j;
  }
  return out;
}

export function statusColor(s: TrenchStatus): string {
  return s === "green" ? "#22c55e" : s === "yellow" ? "#eab308" : "#ef4444";
}

export function statusGlow(s: TrenchStatus): string {
  return s === "green" ? "#22c55e" : s === "yellow" ? "#eab308" : "#ef4444";
}
