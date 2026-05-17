// Server function: geocode a street address to decimal lat/lng using the
// free OpenStreetMap Nominatim service. Used as a fallback when a photo's
// stamped overlay shows an address but no GPS coordinates.
//
// Nominatim ToS: send a real User-Agent, cap to ~1 req/s. We add a simple
// in-memory cache so repeated imports of photos with the same address only
// hit the service once per cold start.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type GeocodeResult = {
  found: boolean;
  lat: number | null;
  lng: number | null;
  displayName: string | null;
};

type NominatimHit = {
  lat: string;
  lon: string;
  display_name: string;
};

const cache = new Map<string, GeocodeResult>();

export const geocodeAddress = createServerFn({ method: "POST" })
  .inputValidator((input: { query: string }) =>
    z.object({ query: z.string().min(3).max(500) }).parse(input),
  )
  .handler(async ({ data }): Promise<GeocodeResult> => {
    const q = data.query.trim();
    const cached = cache.get(q);
    if (cached) return cached;

    // Bias to Austria when the query mentions it — improves accuracy for
    // the typical site photos (Kärnten etc.).
    const looksAustrian = /Austria|Österreich|Австрия|Kärnten|Carinthia/i.test(q);
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("q", q);
    if (looksAustrian) url.searchParams.set("countrycodes", "at");

    try {
      const res = await fetch(url.toString(), {
        headers: {
          "User-Agent": "app/1.0 (photo-import geocoder)",
          "Accept-Language": "de,en",
        },
      });
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      const hits = (await res.json()) as NominatimHit[];
      if (!Array.isArray(hits) || hits.length === 0) {
        const empty: GeocodeResult = {
          found: false,
          lat: null,
          lng: null,
          displayName: null,
        };
        cache.set(q, empty);
        return empty;
      }
      const hit = hits[0];
      const result: GeocodeResult = {
        found: true,
        lat: Number.parseFloat(hit.lat),
        lng: Number.parseFloat(hit.lon),
        displayName: hit.display_name,
      };
      cache.set(q, result);
      return result;
    } catch (err) {
      console.warn("[geocodeAddress] failed:", err);
      return { found: false, lat: null, lng: null, displayName: null };
    }
  });
