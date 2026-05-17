// One-shot: rehash every row in public.images so `sha256` equals
// SHA-256(image bytes) — matching the new bytes-only dedup key. Fetches each
// image from public storage, recomputes the digest, and PATCHes the row only
// when the value changes.
//
// Usage: node scripts/rehash-images.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const eq = line.indexOf("=");
      const k = line.slice(0, eq).trim();
      const v = line
        .slice(eq + 1)
        .trim()
        .replace(/^"|"$/g, "");
      return [k, v];
    }),
);

const SUPABASE_URL = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY in .env");
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function fetchAllImages() {
  const out = [];
  let from = 0;
  const PAGE = 500;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/images?select=id,image_url,sha256&order=id.asc`,
      { headers: { ...headers, Range: `${from}-${from + PAGE - 1}` } },
    );
    if (!res.ok) throw new Error(`list ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function rehashOne(row) {
  const r = await fetch(row.image_url);
  if (!r.ok) throw new Error(`fetch ${r.status} for ${row.id}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha === row.sha256) return { id: row.id, changed: false, sha };
  const up = await fetch(
    `${SUPABASE_URL}/rest/v1/images?id=eq.${encodeURIComponent(row.id)}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ sha256: sha }),
    },
  );
  if (!up.ok) throw new Error(`patch ${up.status} for ${row.id}: ${await up.text()}`);
  return { id: row.id, changed: true, sha, was: row.sha256 };
}

const rows = await fetchAllImages();
console.log(`Found ${rows.length} images`);
let changed = 0;
let unchanged = 0;
let failed = 0;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  try {
    const result = await rehashOne(r);
    if (result.changed) {
      changed++;
      console.log(`[${i + 1}/${rows.length}] ${r.id}: ${result.was?.slice(0, 8)} → ${result.sha.slice(0, 8)}`);
    } else {
      unchanged++;
    }
  } catch (e) {
    failed++;
    console.error(`[${i + 1}/${rows.length}] ${r.id}: ${e.message}`);
  }
}
console.log(`Done. changed=${changed} unchanged=${unchanged} failed=${failed}`);
