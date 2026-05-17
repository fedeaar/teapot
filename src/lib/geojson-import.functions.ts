import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Try multiple property name variants and return the first truthy value. */
function prop(properties: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (properties[k] !== undefined && properties[k] !== null) return properties[k];
  }
  return undefined;
}

function propStr(
  properties: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  const v = prop(properties, ...keys);
  return v !== undefined && v !== null ? String(v) : undefined;
}

function propNum(
  properties: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  const v = prop(properties, ...keys);
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function propBool(
  properties: Record<string, unknown>,
  ...keys: string[]
): boolean | undefined {
  const v = prop(properties, ...keys);
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
  return Boolean(v);
}

function propInt(
  properties: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  const n = propNum(properties, ...keys);
  return n !== undefined ? Math.round(n) : undefined;
}

/** Compute a rough centroid from a GeoJSON geometry (Polygon / MultiPolygon). */
function centroid(geometry: { type: string; coordinates: unknown }): {
  lat: number;
  lng: number;
} {
  const coords: number[][] = [];

  function collect(arr: unknown): void {
    if (!Array.isArray(arr)) return;
    if (arr.length >= 2 && typeof arr[0] === "number" && typeof arr[1] === "number") {
      coords.push(arr as number[]);
      return;
    }
    for (const item of arr) collect(item);
  }

  collect(geometry.coordinates);
  if (coords.length === 0) return { lat: 0, lng: 0 };

  const sum = coords.reduce(
    (acc, c) => ({ lng: acc.lng + c[0], lat: acc.lat + c[1] }),
    { lng: 0, lat: 0 },
  );
  return { lat: sum.lat / coords.length, lng: sum.lng / coords.length };
}

// ---------------------------------------------------------------------------
// Main server function
// ---------------------------------------------------------------------------

export const importGeoJson = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { projectId: string; type: string; geojson: string }) =>
      z
        .object({
          projectId: z.string().uuid(),
          type: z.enum(["clusters", "fcps", "trenches", "fcp_polygons"]),
          geojson: z.string().min(1),
        })
        .parse(input),
  )
  .handler(async ({ data }) => {
    const { projectId, type, geojson } = data;

    const fc = JSON.parse(geojson);
    if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
      throw new Error("Invalid GeoJSON: expected a FeatureCollection");
    }

    const features: Array<{
      type: string;
      geometry: { type: string; coordinates: unknown };
      properties: Record<string, unknown>;
    }> = fc.features;

    // ------------------------------------------------------------------
    // CLUSTERS
    // ------------------------------------------------------------------
    if (type === "clusters") {
      const rows = features
        .filter(
          (f) =>
            f.geometry &&
            (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"),
        )
        .map((f) => {
          const p = f.properties ?? {};
          const c = centroid(f.geometry);
          return {
            external_id: propStr(p, "external_id", "externalID", "externalId", "id"),
            cluster_name:
              propStr(p, "cluster_name", "clusterName", "name", "userLabel") ?? "Unnamed",
            description: propStr(p, "description", "desc"),
            cluster_type: propStr(p, "cluster_type", "clusterType", "type"),
            fill_color: propStr(p, "fill_color", "fillColor", "fill", "color"),
            as_oop: propNum(p, "as_oop", "asOop", "AS_OOP"),
            geometry: f.geometry as unknown as Json,
            lat: c.lat,
            lng: c.lng,
            project_id: projectId,
          };
        });

      if (rows.length === 0) return { inserted: 0 };

      const { error } = await supabase.from("site_clusters").insert(rows);
      if (error) throw new Error(`Insert clusters failed: ${error.message}`);

      return { inserted: rows.length };
    }

    // ------------------------------------------------------------------
    // FCPs
    // ------------------------------------------------------------------
    if (type === "fcps") {
      // Pre-fetch clusters for this project to allow matching by name / external_id
      const { data: clusters } = await supabase
        .from("site_clusters")
        .select("id, cluster_name, external_id")
        .eq("project_id", projectId);

      const clusterMap = new Map<string, string>();
      for (const c of clusters ?? []) {
        if (c.cluster_name) clusterMap.set(c.cluster_name.toLowerCase(), c.id);
        if (c.external_id) clusterMap.set(c.external_id.toLowerCase(), c.id);
      }

      function resolveClusterId(
        p: Record<string, unknown>,
      ): string | undefined {
        const cname = propStr(p, "cluster_name", "clusterName", "cluster");
        const ceid = propStr(p, "cluster_external_id", "clusterExternalId");
        if (cname && clusterMap.has(cname.toLowerCase()))
          return clusterMap.get(cname.toLowerCase());
        if (ceid && clusterMap.has(ceid.toLowerCase()))
          return clusterMap.get(ceid.toLowerCase());
        return undefined;
      }

      const rows = features
        .filter((f) => f.geometry && (f.geometry.type === "Point" || f.geometry.type === "Polygon"))
        .map((f) => {
          const p = f.properties ?? {};
          const isPoint = f.geometry.type === "Point";
          const coords = isPoint
            ? (f.geometry.coordinates as number[])
            : null;
          const c = isPoint ? null : centroid(f.geometry);
          const lat = isPoint ? coords![1] : c!.lat;
          const lng = isPoint ? coords![0] : c!.lng;
          const fcpName = propStr(p, "fcp_name", "fcpName", "name", "userLabel", "kmlDescriptionSimple") ?? "Unnamed";
          return {
            external_id: propStr(p, "external_id", "externalID", "externalId", "id"),
            fcp_name: fcpName,
            as_oop: propNum(p, "as_oop", "asOop", "AS_OOP"),
            fill_color: propStr(p, "fill_color", "fillColor", "fill", "color"),
            execution_state: propStr(
              p,
              "execution_state",
              "executionState",
              "state",
            ),
            count_homes: propInt(p, "count_homes", "countHomes", "homes"),
            count_buildings: propInt(
              p,
              "count_buildings",
              "countBuildings",
              "buildings",
            ),
            planned_cores: propInt(p, "planned_cores", "plannedCores"),
            planned_tu: propInt(p, "planned_tu", "plannedTu", "planned_TU"),
            building_type: propStr(p, "building_type", "buildingType"),
            address: propStr(p, "address"),
            city: propStr(p, "city"),
            zip_code: propStr(p, "zip_code", "zipCode", "zip"),
            district: propStr(p, "district"),
            description: propStr(p, "description", "desc"),
            cluster_name: propStr(p, "cluster_name", "clusterName", "cluster"),
            cluster_id: resolveClusterId(p),
            project_id: projectId,
            point_geometry: isPoint ? (f.geometry as unknown as Json) : null,
            polygon_geometry: !isPoint ? (f.geometry as unknown as Json) : null,
            lat,
            lng,
          };
        });

      if (rows.length === 0) return { inserted: 0 };

      const { error } = await supabase.from("fcps").insert(rows);
      if (error) throw new Error(`Insert fcps failed: ${error.message}`);

      return { inserted: rows.length };
    }

    // ------------------------------------------------------------------
    // TRENCHES
    // ------------------------------------------------------------------
    if (type === "trenches") {
      // Pre-fetch clusters for matching
      const { data: clusters } = await supabase
        .from("site_clusters")
        .select("id, cluster_name, external_id")
        .eq("project_id", projectId);

      const clusterMap = new Map<string, string>();
      for (const c of clusters ?? []) {
        if (c.cluster_name) clusterMap.set(c.cluster_name.toLowerCase(), c.id);
        if (c.external_id) clusterMap.set(c.external_id.toLowerCase(), c.id);
      }

      function resolveClusterId(
        p: Record<string, unknown>,
      ): string | undefined {
        const cname = propStr(p, "cluster_name", "clusterName", "cluster");
        const ceid = propStr(p, "cluster_external_id", "clusterExternalId");
        if (cname && clusterMap.has(cname.toLowerCase()))
          return clusterMap.get(cname.toLowerCase());
        if (ceid && clusterMap.has(ceid.toLowerCase()))
          return clusterMap.get(ceid.toLowerCase());
        return undefined;
      }

      const rows = features
        .filter((f) => f.geometry && f.geometry.type === "LineString")
        .map((f) => {
          const p = f.properties ?? {};
          return {
            external_id: propStr(p, "external_id", "externalID", "externalId", "id"),
            name: propStr(p, "name", "userLabel"),
            as_oop: propNum(p, "as_oop", "asOop", "AS_OOP"),
            fill_color: propStr(p, "fill_color", "fillColor", "fill", "color"),
            execution_state: propStr(
              p,
              "execution_state",
              "executionState",
              "state",
            ),
            execution_state_number: propInt(
              p,
              "execution_state_number",
              "executionStateNumber",
            ),
            master_item: propStr(p, "master_item", "masterItem"),
            kml_type: propStr(p, "kml_type", "kmlType"),
            length_m: propNum(p, "length_m", "lengthM", "length"),
            a_endpoint: propStr(p, "a_endpoint", "aEndpoint", "a_end"),
            z_endpoint: propStr(p, "z_endpoint", "zEndpoint", "z_end"),
            a_end_type: propStr(p, "a_end_type", "aEndType"),
            z_end_type: propStr(p, "z_end_type", "zEndType"),
            is_connected_to_home: propBool(
              p,
              "is_connected_to_home",
              "isConnectedToHome",
              "connectedToHome",
            ),
            duct_main_short: propStr(p, "duct_main_short", "ductMainShort"),
            duct_main_full: propStr(p, "duct_main_full", "ductMainFull"),
            duct_contained_size: propInt(
              p,
              "duct_contained_size",
              "ductContainedSize",
            ),
            duct_type: propStr(p, "duct_type", "ductType"),
            assigned_tu: propInt(p, "assigned_tu", "assignedTu", "assigned_TU"),
            cluster_id: resolveClusterId(p),
            project_id: projectId,
            geometry: f.geometry as unknown as Json,
          };
        });

      if (rows.length === 0) return { inserted: 0 };

      const { error } = await supabase.from("trenches").insert(rows);
      if (error) throw new Error(`Insert trenches failed: ${error.message}`);

      return { inserted: rows.length };
    }

    // ------------------------------------------------------------------
    // FCP_POLYGONS — update existing FCPs with polygon geometry
    // ------------------------------------------------------------------
    if (type === "fcp_polygons") {
      // Fetch FCPs for this project to match against
      const { data: existingFcps } = await supabase
        .from("fcps")
        .select("id, external_id, as_oop, fcp_name, lat, lng")
        .eq("project_id", projectId);

      if (!existingFcps || existingFcps.length === 0) {
        return { updated: 0, debug: "No existing FCPs found for this project" };
      }

      // Build lookup maps
      const byExternalId = new Map<string, string>();
      const byAsOop = new Map<number, string>();
      const byName = new Map<string, string>();
      for (const fcp of existingFcps) {
        if (fcp.external_id) byExternalId.set(fcp.external_id, fcp.id);
        if (fcp.as_oop != null) byAsOop.set(Number(fcp.as_oop), fcp.id);
        if (fcp.fcp_name) byName.set(fcp.fcp_name.toLowerCase(), fcp.id);
      }

      /** Point-in-polygon test (GeoJSON [lng, lat] order). */
      function geoPointInRing(pt: [number, number], ring: number[][]): boolean {
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

      let updated = 0;
      let polygonCount = 0;
      let unmatched: string[] = [];

      for (const f of features) {
        if (!f.geometry || f.geometry.type !== "Polygon") continue;
        polygonCount++;
        const p = f.properties ?? {};
        const eid = propStr(p, "external_id", "externalID", "externalId", "id");
        const asOop = propNum(p, "as_oop", "asOop", "AS_OOP");
        const name = propStr(p, "fcp_name", "fcpName", "name", "userLabel");
        const polygonAsOop = propNum(
          p,
          "polygon_as_oop",
          "polygonAsOop",
          "as_oop",
          "asOop",
          "AS_OOP",
        );

        let fcpId: string | undefined;
        // 1. Try property-based matching
        if (eid && byExternalId.has(eid)) fcpId = byExternalId.get(eid);
        if (!fcpId && asOop != null && byAsOop.has(asOop))
          fcpId = byAsOop.get(asOop);
        if (!fcpId && name && byName.has(name.toLowerCase()))
          fcpId = byName.get(name.toLowerCase());

        // 2. Spatial match: find the FCP point that falls inside this polygon
        if (!fcpId) {
          const ring = (f.geometry.coordinates as number[][][])[0];
          if (ring) {
            const match = existingFcps.find(
              (fcp) => fcp.lat != null && fcp.lng != null && geoPointInRing([fcp.lng, fcp.lat], ring),
            );
            if (match) fcpId = match.id;
          }
        }

        if (!fcpId) {
          if (unmatched.length < 5) unmatched.push(JSON.stringify({ eid, asOop, name }));
          continue;
        }

        const { error } = await supabase
          .from("fcps")
          .update({
            polygon_geometry: f.geometry as unknown as Json,
            polygon_as_oop: polygonAsOop,
          })
          .eq("id", fcpId);

        if (!error) updated++;
      }

      return { updated, debug: `${existingFcps.length} FCPs in DB, ${polygonCount} polygons in file, unmatched samples: ${unmatched.join(", ")}` };
    }

    throw new Error(`Unknown import type: ${type}`);
  });
