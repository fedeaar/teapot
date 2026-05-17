import type { ProjectData, ProjectTrench } from "@/lib/project-data";
import type { SiteData, Trench } from "@/lib/site-data";

function flipLngLat(pairs: [number, number][]): [number, number][] {
  return pairs.map(([lng, lat]) => [lat, lng]);
}

function adaptTrench(trench: Trench): ProjectTrench {
  return {
    id: trench.id,
    name: trench.label || trench.id,
    externalId: trench.id,
    clusterId: null,
    geometry: flipLngLat(trench.coords),
    lengthM: null,
    fillColor: trench.color,
    executionState: trench.state,
  };
}

export function siteDataToProjectData(site: SiteData): ProjectData {
  const fcpPolygons: Record<string, [number, number][]> = {};
  for (const polygon of site.fcpPolygons) {
    fcpPolygons[polygon.fcpId] = flipLngLat(polygon.ring);
  }

  const trenches = site.trenches.map(adaptTrench);
  const trenchById = new Map(trenches.map((trench) => [trench.id, trench]));
  const trenchesByFcp: ProjectData["trenchesByFcp"] = {};
  for (const [fcpId, list] of Object.entries(site.trenchesByFcp)) {
    trenchesByFcp[fcpId] = list
      .map((trench) => trenchById.get(trench.id))
      .filter((trench): trench is ProjectTrench => Boolean(trench));
  }

  return {
    clusters: site.siteRing
      ? [
          {
            id: "demo-site",
            name: "Demo route boundary",
            geometry: flipLngLat(site.siteRing),
            lat: null,
            lng: null,
          },
        ]
      : [],
    fcps: site.fcps.map((fcp) => ({
      id: fcp.id,
      name: fcp.id,
      externalId: fcp.externalId ?? null,
      clusterId: null,
      lat: fcp.lat,
      lng: fcp.lng,
      polygon: fcpPolygons[fcp.id] ?? null,
      fillColor: null,
      address: fcp.address ?? null,
    })),
    trenches,
    trenchesByFcp,
    fcpPolygons,
  };
}
