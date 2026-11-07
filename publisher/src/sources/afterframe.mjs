// AfterFrame source: every folder collection in the open catalog is a series, in the sidebar's order, unless
// galleries.yaml skips it. The members' originals stay where they are on disk; this import reads each file
// once (content hash, oriented size, perceptual hash, EXIF with GPS) and remembers the result by path, size
// and mtime, so later imports only touch new or changed photos. Output: .cache/originals/<slug>/index.json
// in the shared layout (publisher/src/cache.mjs), plus a refreshed on-site match so an old map photo that is
// also a gallery photo is published once.
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { AfterFrame } from "../afterframe.mjs";
import { RENDER_VERSION } from "../render.mjs";
import { toHex } from "../cache.mjs";
import { describe } from "../exif.mjs";
import { dhash, rematchOnsite } from "./onsite.mjs";

const DECODABLE = /\.(jpe?g|png|tiff?|webp)$/i;
const CONCURRENCY = 3; // the originals are large (100 MP Hasselblad JPEGs) and may sit on a USB drive

export async function importAfterframe({ cacheDir, port, config, log = console.log }) {
  const af = new AfterFrame({ port });
  const info = await af.connect();
  const skip = new Set(config.afterframe?.skip ?? []);
  const overrides = new Map(config.galleries.map((g) => [g.collection, g]));
  const collections = (await af.collections())
    .filter((c) => c.kind === "manual" && !skip.has(c.name))
    .sort((a, b) => a.sort_order - b.sort_order);
  log(`AfterFrame ${info.version}: ${collections.length} collections to publish`);

  const files = new FileCache(path.join(cacheDir, "afterframe-files.json"));
  await files.load();
  const slugs = new Set();
  const galleries = [];
  let read = 0, cached = 0;
  for (const c of collections) {
    const o = overrides.get(c.name);
    const slug = o?.slug ?? slugify(c.name);
    if (slugs.has(slug)) throw new Error(`two collections map to the slug "${slug}" (${c.name}); give one a slug in galleries.yaml`);
    slugs.add(slug);
    const members = (await af.members(c.collection_id)).filter((a) => a.asset_type === "image");
    const items = new Array(members.length);
    const unreadable = [];
    await runPool(members.map((a, i) => async () => {
      const file = a.image_path;
      if (!file || !DECODABLE.test(file)) { unreadable.push(a.stem ?? a.asset_id); return; }
      let rec;
      try { rec = await files.get(file, () => { read++; return inspect(file); }); }
      catch (err) { unreadable.push(`${path.basename(file)} (${err.message})`); return; }
      if (rec.fromCache) cached++;
      items[i] = {
        id: rec.id, path: file, file: path.basename(file), stem: a.stem ?? path.basename(file).replace(/\.[^.]+$/, ""), asset_id: a.asset_id,
        w: rec.w, h: rec.h, dhash: rec.dhash, alt: a.caption && !/\.(jpe?g|png)$/i.test(a.caption) ? a.caption : "",
        taken: rec.taken ?? a.capture_time ?? null, geo: rec.geo, exif: rec.exif,
      };
    }), CONCURRENCY);
    const kept = items.filter(Boolean);
    if (unreadable.length) log(`  ${slug}: skipped ${unreadable.length} (${unreadable.slice(0, 3).join(", ")}${unreadable.length > 3 ? ", …" : ""})`);
    if (!kept.length) { log(`  ${slug}: nothing publishable, skipped`); continue; }
    await mkdir(path.join(cacheDir, slug), { recursive: true });
    await writeFile(path.join(cacheDir, slug, "index.json"), JSON.stringify({
      slug, source: "afterframe", collection: c.name, collection_id: c.collection_id, position: galleries.length,
      imported_at: new Date().toISOString(), items: kept,
    }, null, 1));
    galleries.push({ slug, collection: c.name, count: kept.length });
    log(`  ${slug}: ${kept.length} photos, ${kept.filter((it) => it.taken).length} dated, ${kept.filter((it) => it.geo).length} with GPS`);
  }
  await files.save();
  log(`afterframe: ${galleries.length} galleries, ${galleries.reduce((n, g) => n + g.count, 0)} photos (${read} files read, ${cached} from cache)`);

  const matched = await rematchOnsite({ cacheDir, slugs: galleries.map((g) => g.slug), log });
  if (matched != null) log(`on-site: ${matched} map photos are also gallery photos (published once)`);
  await writeFile(path.join(cacheDir, "afterframe.json"), JSON.stringify({ imported_at: new Date().toISOString(), galleries }, null, 1));
  return galleries;
}

// Everything render and the matcher need from one original, read once.
async function inspect(file) {
  const buf = await readFile(file);
  const id = createHash("sha1").update(buf).update(`v${RENDER_VERSION}`).digest("hex").slice(0, 12);
  const meta = await sharp(buf, { failOn: "none" }).metadata();
  const swap = meta.orientation && meta.orientation >= 5;
  const [w, h] = swap ? [meta.height, meta.width] : [meta.width, meta.height];
  const [hash, info] = await Promise.all([dhash(buf), describe(file)]);
  return { id, w, h, dhash: toHex(hash), ...info };
}

export const slugify = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Per-file memo keyed by path + size + mtime, so reruns do not reread 50 MB originals from the drive.
class FileCache {
  constructor(file) { this.file = file; this.map = new Map(); this.dirty = false; }
  async load() { try { this.map = new Map(Object.entries(JSON.parse(await readFile(this.file, "utf8")))); } catch { this.map = new Map(); } }
  async get(file, compute) {
    const st = await stat(file);
    const key = `${file}|${st.size}|${Math.round(st.mtimeMs)}`;
    const hit = this.map.get(key);
    if (hit) return { ...hit, fromCache: true };
    const rec = await compute();
    this.map.set(key, rec);
    this.dirty = true;
    return rec;
  }
  async save() { if (this.dirty) await writeFile(this.file, JSON.stringify(Object.fromEntries(this.map))); }
}

async function runPool(tasks, n) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) { const t = tasks[i++]; await t(); }
  }));
}
