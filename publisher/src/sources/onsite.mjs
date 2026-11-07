// on-site.photos source: the old map site's posts (MongoDB Atlas) and their originals (Cloudflare Images).
// Produces .cache/originals/on-site/<imageId>.jpg + index.json like the other sources, with real coordinates,
// address and EXIF per item. Images that are also in a gallery are matched by perceptual hash (rematchOnsite,
// run after every gallery import) so render gives that gallery photo the real data instead of publishing twice.
// Credentials are read from the old server's .env (ONSITE_SERVER_ENV); nothing is copied or printed.
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";
import sharp from "sharp";
import { readIndex, toHex, fromHex } from "../cache.mjs";

export const ONSITE_SLUG = "on-site";
const DOWNLOAD_CONCURRENCY = 6;
const MATCH_THRESHOLD = 24; // dHash bits out of 256; verified by eye on this archive

export async function importOnsite({ cacheDir, serverEnv, log = console.log }) {
  const env = parseEnv(await readFile(serverEnv, "utf8"));
  for (const k of ["MONGO_URI", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]) if (!env[k]) throw new Error(`${k} missing in ${serverEnv}`);
  const dir = path.join(cacheDir, ONSITE_SLUG);
  await mkdir(dir, { recursive: true });

  const posts = await fetchPosts(env.MONGO_URI);
  log(`on-site: ${posts.length} posts, ${posts.reduce((n, p) => n + (p.images?.length ?? 0), 0)} images`);

  const items = [];
  for (const p of posts) {
    for (const [i, im] of (p.images ?? []).entries()) {
      const imageId = im.url.split("/").pop();
      items.push({ file: `${imageId}.jpg`, stem: imageId, alt: "", postId: String(p._id), postIndex: i, ...describe(p, im) });
    }
  }

  // Originals via the Images API (delivery URLs are private). Skips files already in the cache.
  let downloaded = 0;
  const queue = items.filter((it) => !existsSync(path.join(dir, it.file)));
  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const it = queue.shift();
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/images/v1/${it.stem}/blob`, { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
      if (!res.ok) throw new Error(`images api ${res.status} for ${it.stem}`);
      await writeFile(path.join(dir, it.file), Buffer.from(await res.arrayBuffer()));
      if (++downloaded % 25 === 0) log(`  ${downloaded}/${queue.length + downloaded} downloaded`);
    }
  }));
  log(`on-site: ${downloaded} downloaded, ${items.length - downloaded} already cached`);

  for (const it of items) it.dhash = toHex(await dhash(path.join(dir, it.file)));
  items.sort((a, b) => (b.taken ?? "").localeCompare(a.taken ?? "") || a.postIndex - b.postIndex);
  await writeFile(path.join(dir, "index.json"), JSON.stringify({ slug: ONSITE_SLUG, imported_at: new Date().toISOString(), items }, null, 1));
  return { posts: posts.length, images: items.length };
}

// Point each on-site image at the gallery photo it duplicates, if any, by perceptual hash. Gallery indexes
// carry their items' hashes (the AfterFrame import computes them); the on-site index gets its own on first use.
// Returns the number matched, or null when there is no on-site index.
export async function rematchOnsite({ cacheDir, slugs, log = console.log }) {
  const idx = await readIndex(cacheDir, ONSITE_SLUG);
  if (!idx) return null;
  const others = [];
  for (const slug of slugs) {
    const g = await readIndex(cacheDir, slug);
    for (const it of g?.items ?? []) if (it.dhash) others.push({ gallery: slug, file: it.file, hash: fromHex(it.dhash) });
  }
  let matched = 0;
  for (const it of idx.items) {
    if (!it.dhash) it.dhash = toHex(await dhash(path.join(cacheDir, ONSITE_SLUG, it.file)));
    const h = fromHex(it.dhash);
    let best = null;
    for (const o of others) { const d = hamming(h, o.hash); if (!best || d < best.d) best = { d, o }; }
    it.match = best && best.d <= MATCH_THRESHOLD ? { gallery: best.o.gallery, file: best.o.file, distance: best.d } : null;
    if (it.match) matched++;
  }
  await writeFile(path.join(cacheDir, ONSITE_SLUG, "index.json"), JSON.stringify(idx, null, 1));
  return matched;
}

async function fetchPosts(uri) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  try {
    await client.connect();
    return await client.db().collection("imageposts").find({}).toArray();
  } finally { await client.close(); }
}

// One item's public data from a post and its image record. Precision is exact: these were placed by hand on the map.
function describe(post, im) {
  const ex = im.exif ?? post.exifData ?? {};
  const geo = post.geoLocation ?? {};
  const taken = (ex.dateTimeOriginal && isoFromExif(ex.dateTimeOriginal)) || (post.takenTime ? new Date(post.takenTime).toISOString() : null);
  return {
    taken,
    geo: Number.isFinite(geo.lat) && Number.isFinite(geo.lng) ? { lat: round(geo.lat), lng: round(geo.lng), precision: "exact" } : null,
    place: placeOf(ex, geo),
    address: geo.fullAddress || null,
    exif: exifOf(ex, taken),
  };
}

// "City, Region" from the geocoded address: country dropped, postal and plus codes stripped, last two parts kept.
// "1096 Point Lobos Ave, San Francisco, CA 94121, USA" → "San Francisco, CA"; "2-chōme-28-7 Dōgenzaka, Shibuya,
// Tokyo 150-0043, Japan" → "Shibuya, Tokyo". Falls back to the post's own place name.
const COUNTRIES = new Set(["usa", "united states", "japan", "china", "taiwan", "hong kong", "south korea", "korea", "uk", "united kingdom", "france", "italy", "germany", "spain", "canada", "mexico", "australia", "singapore", "thailand", "vietnam"]);
function placeOf(ex, geo) {
  if (ex.city) return [ex.city, ex.isoCountryCode === "US" ? ex.state : ex.country].filter(Boolean).join(", ");
  let parts = (geo.fullAddress || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length && COUNTRIES.has(parts[0].toLowerCase())) parts.reverse(); // "Japan, 〒106-0032 Tokyo, Minato City, …"
  if (parts.length && COUNTRIES.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  parts = parts.map((s) => s.replace(/〒?\d{3}-\d{4}/g, "").replace(/\b\d{5}(?:-\d{4})?\b/g, "").replace(/^[A-Z0-9]{4,}\+[A-Z0-9]{2,}\s*/, "").trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join(", ");
  return parts[0] || geo.name || null;
}

export function exifOf(ex, taken) {
  const camera = ex.model ? (ex.make && !ex.model.startsWith(ex.make) ? `${ex.make} ${ex.model}` : ex.model) : null;
  const out = {
    camera, lens: ex.lens || undefined,
    focal: ex.focalLength ? Math.round(ex.focalLength) : undefined,
    aperture: ex.fNumber || undefined,
    shutter: ex.exposureTime ? shutterOf(ex.exposureTime) : undefined,
    iso: ex.iso || undefined,
    taken: taken ? taken.slice(0, 7) : undefined,
  };
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return Object.keys(out).length ? out : null;
}

const shutterOf = (t) => (t >= 1 ? `${+t.toFixed(1)}"` : `1/${Math.round(1 / t)}`);
const round = (n) => +n.toFixed(5);
export function isoFromExif(s) { // "2021:11:13 15:13:00" or already ISO
  const m = String(s).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  const d = new Date(s); return Number.isNaN(+d) ? null : d.toISOString();
}

export async function dhash(fileOrBuffer) {
  const { data } = await sharp(fileOrBuffer, { failOn: "none" }).rotate().grayscale().resize(17, 16, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const bits = new Uint8Array(256);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) bits[y * 16 + x] = data[y * 17 + x] < data[y * 17 + x + 1] ? 1 : 0;
  return bits;
}
export const hamming = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) n += a[i] ^ b[i]; return n; };

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trimStart().startsWith("#")) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

// Used by render: the overrides for gallery photos, keyed "gallery/file".
export async function readOnsiteOverrides(cacheDir) {
  const idx = await readIndex(cacheDir, ONSITE_SLUG);
  const map = new Map();
  for (const it of idx?.items ?? []) if (it.match) map.set(`${it.match.gallery}/${it.match.file}`, it);
  return map;
}
