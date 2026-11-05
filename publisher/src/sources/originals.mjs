// Local originals: the exported JPEGs the Squarespace galleries were uploaded from, still on the user's disks
// with their EXIF (Squarespace strips it). The configured folders are walked once; each cached gallery photo
// is looked up by file name first, then, for the ones whose name changed on export, by perceptual hash over
// every image in those folders (hashes are cached, so the scan costs once). A match is confirmed by hash either
// way, and its capture time, exposure, camera and GPS (when the camera wrote any) are written into the source's
// index.json, where render picks them up. Nothing is copied; the index only remembers the path it matched.
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import { readIndex } from "./squarespace.mjs";
import { dhash, hamming, exifOf, isoFromExif } from "./onsite.mjs";

const MATCH_THRESHOLD = 10; // dHash bits out of 256: the same frame exported twice, not a look-alike
const DECODABLE = /\.(jpe?g|png|tiff?|webp|heic)$/i;
const SKIP_DIRS = new Set(["node_modules", ".cache", "Lightroom Catalog Previews.lrdata", "Previews.lrdata"]);

export async function enrichFromOriginals({ cacheDir, sqSources, roots, force = false, log = console.log }) {
  if (!roots.length) throw new Error("no roots to search (ORIGINALS_ROOTS)");
  log(`walking ${roots.join(", ")} …`);
  const files = await walk(roots);
  log(`  ${files.length} images`);
  const hashes = new HashCache(path.join(cacheDir, "originals-hashes.json"));
  await hashes.load();

  const pending = []; // [{ it, idx, want }]
  const totals = { items: 0, matched: 0, dated: 0, located: 0, skipped: 0 };
  const indexes = [];
  for (const slug of sqSources) {
    const idx = await readIndex(cacheDir, slug);
    if (!idx) continue;
    indexes.push(idx);
    for (const it of idx.items) {
      totals.items++;
      if (it.original && !force) { totals.skipped++; continue; }
      const want = await dhash(path.join(cacheDir, idx.slug, it.file));
      const byName = await bestOf(candidatesByName(files, it.stem), want, hashes);
      if (byName) await adopt(it, byName); else pending.push({ it, want });
    }
  }

  // Names that changed on export: one pass over every image, comparing hashes.
  if (pending.length) {
    log(`  ${pending.length} not found by name; comparing hashes of all ${files.length} images (cached after the first run)`);
    let n = 0;
    for (const file of files) {
      const h = await hashes.get(file);
      if (++n % 1000 === 0) log(`    ${n}/${files.length}`);
      if (!h) continue;
      for (const p of pending) {
        const d = hamming(p.want, h);
        if (d <= MATCH_THRESHOLD && (!p.best || d < p.best.d)) p.best = { file, d };
      }
    }
    for (const p of pending) if (p.best) await adopt(p.it, p.best);
  }
  await hashes.save();

  for (const idx of indexes) {
    const m = idx.items.filter((it) => it.original);
    const missing = idx.items.filter((it) => !it.original).map((it) => it.stem);
    totals.matched += m.length; totals.dated += m.filter((it) => it.taken).length; totals.located += m.filter((it) => it.geo).length;
    await writeFile(path.join(cacheDir, idx.slug, "index.json"), JSON.stringify(idx, null, 1));
    log(`  ${idx.slug}: ${m.length}/${idx.items.length} matched, ${m.filter((it) => it.taken).length} dated, ${m.filter((it) => it.geo).length} with GPS${missing.length ? `; not found: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ` +${missing.length - 4}` : ""}` : ""}`);
  }
  log(`originals: ${totals.matched} matched (${totals.skipped} kept from before), ${totals.dated} dated, ${totals.located} with GPS, of ${totals.items} gallery photos`);
  return totals;
}

async function adopt(it, best) {
  Object.assign(it, { original: best.file, original_distance: best.d, ...(await describe(best.file)) });
}

// Squarespace turned spaces into "+"; exports may add " copy", "-2" and the like after the stem.
function candidatesByName(files, stem) {
  const name = stem.replace(/\+/g, " ").toLowerCase();
  return files.filter((f) => path.basename(f).toLowerCase().startsWith(name));
}

// The closest candidate within the threshold; among equals, one whose EXIF carries a capture time.
async function bestOf(candidates, want, hashes) {
  const scored = [];
  for (const file of candidates) { const h = await hashes.get(file); if (h) scored.push({ file, d: hamming(want, h) }); }
  const close = scored.filter((s) => s.d <= MATCH_THRESHOLD).sort((a, b) => a.d - b.d);
  if (!close.length) return null;
  for (const c of close.slice(0, 4)) c.dated = Boolean((await readExif(c.file))?.DateTimeOriginal);
  return close.sort((a, b) => Number(b.dated) - Number(a.dated) || a.d - b.d)[0];
}

async function walk(roots) {
  const out = [];
  async function visit(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await visit(p);
      else if (e.isFile() && DECODABLE.test(e.name)) out.push(p);
    }
  }
  for (const r of roots) await visit(r);
  return out;
}

// dHash per file, remembered with the file's size and mtime so later runs only hash what changed.
class HashCache {
  constructor(file) { this.file = file; this.map = new Map(); this.dirty = 0; }
  async load() { try { this.map = new Map(Object.entries(JSON.parse(await readFile(this.file, "utf8")))); } catch { /* first run */ } }
  async get(file) {
    let st; try { st = await stat(file); } catch { return null; }
    const key = `${st.size}:${Math.round(st.mtimeMs)}`;
    const hit = this.map.get(file);
    if (hit && hit.k === key) return hit.h === null ? null : fromHex(hit.h);
    let h = null;
    try { h = await dhash(file); } catch { /* not decodable: remembered as null */ }
    this.map.set(file, { k: key, h: h && toHex(h) });
    if (++this.dirty % 500 === 0) await this.save();
    return h;
  }
  async save() { await writeFile(this.file, JSON.stringify(Object.fromEntries(this.map))); }
}
const toHex = (bits) => { let s = ""; for (let i = 0; i < bits.length; i += 4) s += (bits[i] * 8 + bits[i + 1] * 4 + bits[i + 2] * 2 + bits[i + 3]).toString(16); return s; };
const fromHex = (hex) => { const b = new Uint8Array(hex.length * 4); for (let i = 0; i < hex.length; i++) { const v = parseInt(hex[i], 16); b[i * 4] = v >> 3 & 1; b[i * 4 + 1] = v >> 2 & 1; b[i * 4 + 2] = v >> 1 & 1; b[i * 4 + 3] = v & 1; } return b; };

async function readExif(file) {
  try {
    return await exifr.parse(file, { pick: ["DateTimeOriginal", "Make", "Model", "LensModel", "FNumber", "ExposureTime", "ISO", "FocalLength", "latitude", "longitude", "GPSLatitude", "GPSLongitude"], gps: true });
  } catch { return null; }
}

async function describe(file) {
  const ex = (await readExif(file)) ?? {};
  const taken = ex.DateTimeOriginal instanceof Date && !Number.isNaN(+ex.DateTimeOriginal)
    ? localIso(ex.DateTimeOriginal) : ex.DateTimeOriginal ? isoFromExif(ex.DateTimeOriginal) : null;
  const geo = Number.isFinite(ex.latitude) && Number.isFinite(ex.longitude) && (ex.latitude || ex.longitude)
    ? { lat: +ex.latitude.toFixed(5), lng: +ex.longitude.toFixed(5), precision: "exact" } : null;
  return {
    taken, geo,
    exif: exifOf({ make: ex.Make, model: ex.Model, lens: ex.LensModel, focalLength: ex.FocalLength, fNumber: ex.FNumber, exposureTime: ex.ExposureTime, iso: ex.ISO }, taken),
  };
}

// exifr parses EXIF's zone-less timestamps as if they were UTC; keep the wall-clock digits as written.
const localIso = (d) => d.toISOString().slice(0, 19);
