// render: originals → content-addressed WebP ladder + manifest.json.
// Rules (docs/plan.md §4.3): auto-rotate, convert to sRGB and strip metadata (sharp's default), never enlarge,
// ladder 480/1200/2000/3200/6000 plus the source's own long edge when it is smaller than the top rung and falls
// between rungs, q80 for 480 and q82 above. Nothing larger than 6000 px is ever published (the originals are
// up to 11600 px).
// Series come from the AfterFrame import (sidebar order) plus any `source` entries in galleries.yaml. Camera
// data and coordinates come from the source index; photos without any get null, or placeholders when --mock
// is passed (dev only: the site says so in the legend). A series' tone is dark when its photographs are.
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import YAML from "yaml";
import { GalleriesConfig, Manifest } from "./manifest.mjs";
import { readIndex, itemPath } from "./cache.mjs";
import { readOnsiteOverrides } from "./sources/onsite.mjs";
import { gearOf } from "./equipment.mjs";

export const RENDER_VERSION = 1;
const LADDER = [480, 1200, 2000, 3200, 6000];
const CONCURRENCY = 4;
const DARK_BELOW = 80;
const SHARE_EDGE = 1200; // long edge of a cover's link-preview JPEG
const RECENT = 36, RECENT_PER_SERIES = 3; // Recent = the newest dated photos, no series taking more than its share // median mean-luminance (0–255) under which a series is presented on a dark page

export async function render({ cacheDir, galleries: galleriesPath, outDir, manifest: manifestPath, imageBase, force, mock = false, log = console.log }) {
  const config = GalleriesConfig.parse(YAML.parse(await readFile(galleriesPath, "utf8")));
  await mkdir(outDir, { recursive: true });
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const overrides = await readOnsiteOverrides(cacheDir);

  const galleries = [];
  const recent = []; // first photos of each series, used until capture times are known
  const dated = []; // every visible photo with a capture time
  let rendered = 0, reused = 0, mocked = 0;

  for (const g of await seriesList(cacheDir, config, log)) {
    const index = await readIndex(cacheDir, g.source ?? g.slug);
    if (!index) { log(`  ${g.slug}: no originals in cache, skipped`); continue; }
    // An on-site image that is also a gallery photo is published once, as that gallery photo.
    const sourceItems = index.items.filter((it) => !it.match);
    const items = new Array(sourceItems.length);
    await runPool(sourceItems.map((it, i) => async () => {
      const file = itemPath(cacheDir, index, it);
      // The AfterFrame import already hashed and measured the file; reading it again is only for missing sizes.
      let buf = null, id = it.id, w = it.w, h = it.h;
      if (!id || !w || !h) {
        buf = await readFile(file);
        id ??= createHash("sha1").update(buf).update(`v${RENDER_VERSION}`).digest("hex").slice(0, 12);
        [w, h] = orientedSize(await sharp(buf, { failOn: "none" }).metadata());
      }
      const dir = path.join(outDir, id);
      const longEdge = Math.max(w, h);
      const sizes = LADDER.filter((s) => s < longEdge);
      if (sizes.length === 0 || (longEdge < LADDER.at(-1) && longEdge - sizes.at(-1) > 200)) sizes.push(longEdge);
      const outputs = [];
      let master = null; // the original decoded once, at the largest rung; the smaller rungs are cut from it
      for (const s of [...sizes].reverse()) {
        const out = path.join(dir, `${s}.webp`);
        if (!force && existsSync(out) && (await stat(out)).size > 0) { reused++; outputs.unshift(s); continue; }
        if (!master) {
          buf ??= await readFile(file);
          const top = sizes.at(-1);
          const { data, info } = await sharp(buf, { failOn: "none" }).rotate().resize({ width: top, height: top, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
          master = { data, raw: { width: info.width, height: info.height, channels: info.channels } };
        }
        await mkdir(dir, { recursive: true });
        let pipe = sharp(master.data, { raw: master.raw }).resize({ width: s, height: s, fit: "inside", withoutEnlargement: true });
        if (s <= 1200) pipe = pipe.sharpen({ sigma: 0.6 });
        await pipe.webp({ quality: s <= 480 ? 80 : 82, effort: 4 }).toFile(out);
        rendered++;
        outputs.unshift(s);
      }
      // Real data: the item's own (EXIF of the original, or the on-site source) or the on-site match for this photo.
      const real = it.geo || it.exif ? it : overrides.get(`${g.source ?? g.slug}/${it.file}`);
      const isMock = !real && mock;
      if (isMock) mocked++;
      items[i] = {
        id, w, h,
        shape: w > h * 1.05 ? "landscape" : h > w * 1.05 ? "portrait" : "square",
        sizes: outputs,
        alt: it.alt && !/\.(jpe?g|png)$/i.test(it.alt) ? it.alt : "",
        exif: real?.exif ?? (isMock ? mockExif(id, g) : null),
        geo: real?.geo ?? (isMock ? mockGeo(id, g) : null),
        place: real?.place ?? (real ? g.place ?? null : null), // the series' place stands in when the photo has no address
        taken: real?.taken ?? it.taken ?? null,
        mock: isMock,
        _lum: await luminance(path.join(dir, `${outputs[0]}.webp`)),
        _pick: it.pick ? 1 : 0,
      };
    }), CONCURRENCY);

    // Order: the photos flagged P in AfterFrame open the series (the first is the cover), then the rest, by time.
    const byTime = (a, b) => (a.taken ?? "9").localeCompare(b.taken ?? "9");
    if (g.order === "best") items.sort((a, b) => (b._pick - a._pick) || byTime(a, b));
    else if (g.order !== "manual" && items.some((it) => it.taken)) items.sort(byTime);
    if (g.order === "captured_desc") items.reverse();
    placeApproximately(items, g);
    const coverId = g.cover ? items.find((it, i) => sourceItems[i].stem === g.cover)?.id : undefined;
    const tone = g.tone === "auto" ? ((median(items.map((it) => it._lum).filter((v) => v != null)) ?? 255) < DARK_BELOW ? "dark" : "light") : g.tone;
    for (const it of items) { delete it._lum; delete it._pick; }
    const cover = items.find((it) => it.id === coverId) ?? items[0];
    galleries.push({
      slug: g.slug, title: g.title, year: g.year ?? null, place: g.place ?? null, tone, description: g.description ?? "",
      gear: gearOf(items, config.equipment),
      hidden: g.hidden ?? false, cover: cover.id, share: g.hidden ? null : await shareImage(outDir, cover, force), count: items.length, items,
      zh: g.zh ?? {},
    });
    if (!g.hidden) recent.push(...items.slice(0, 3).map((it) => it.id));
    if (!g.hidden) dated.push(...items.filter((it) => it.taken && !it.mock).map((it) => ({ id: it.id, taken: it.taken, series: g.slug })));
    log(`  ${g.slug}: ${items.length} photos${g.hidden ? " (hidden)" : ""}, ${tone}, ${items.filter((it) => it.geo?.precision === "exact" && !it.mock).length} located, ${items.filter((it) => it.geo && it.geo.precision !== "exact").length} placed${galleries.at(-1).gear.length ? ", " + galleries.at(-1).gear.join(" / ") : ""}`);
  }

  if (config.site.series_order === "newest_first") {
    const when = (g) => g.year ? `${g.year}-07` : median(g.items.map((it) => it.taken).filter(Boolean).sort()) ?? "";
    const hidden = galleries.filter((g) => g.hidden), visible = galleries.filter((g) => !g.hidden);
    visible.sort((a, b) => when(b).localeCompare(when(a)));
    galleries.splice(0, galleries.length, ...visible, ...hidden);
  }

  const manifest = Manifest.parse({
    version: 1,
    generated_at: new Date().toISOString(),
    site: { title: config.site.title, image_base: imageBase, exif_mock: mocked > 0, geo_mock: mocked > 0, links: config.site.links },
    galleries,
    // Recent = the newest photographs by capture time, at most RECENT_PER_SERIES from any one series, once most
    // of the archive carries a capture time.
    recent: [...new Set(dated.length >= recent.length ? newest(dated) : recent)].slice(0, RECENT),
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 1));
  const all = galleries.flatMap((g) => g.items);
  log(`manifest: ${galleries.length} galleries, ${all.length} photos (${all.filter((it) => it.geo && !it.mock).length} located, ${mocked} mocked); rendered ${rendered}, reused ${reused} files → ${path.relative(process.cwd(), manifestPath)}`);
}

// Photos without coordinates are placed at the series' location (galleries.yaml), or else at the centre of the
// series' located photos, spread a little so they stay clickable at street zoom; the precision says they are
// approximate and the map draws them so.
const SPREAD = { landmark: 0.0004, locality: 0.004, admin1: 0.03 }; // degrees of latitude: ~45 m, ~450 m, ~3 km
function placeApproximately(items, g) {
  const missing = items.filter((it) => !it.geo);
  if (!missing.length) return;
  let at = g.location ? { ...g.location } : null;
  if (!at) {
    const real = items.filter((it) => it.geo && it.geo.precision === "exact" && !it.mock);
    if (!real.length) return;
    at = { lat: real.reduce((a, it) => a + it.geo.lat, 0) / real.length, lng: real.reduce((a, it) => a + it.geo.lng, 0) / real.length, precision: "locality" };
  }
  const r0 = SPREAD[at.precision] ?? SPREAD.locality;
  for (const it of missing) {
    const n = parseInt(it.id.slice(0, 8), 16) >>> 0;
    const r = r0 * Math.sqrt((n & 0xfff) / 0xfff), a = ((n >>> 12) & 0xfff) / 0xfff * Math.PI * 2;
    it.geo = { lat: +(at.lat + r * Math.sin(a)).toFixed(5), lng: +(at.lng + r * Math.cos(a) / Math.cos(at.lat * Math.PI / 180)).toFixed(5), precision: at.precision };
    it.place ??= g.place ?? null;
  }
}

function newest(dated) {
  const perSeries = new Map();
  const out = [];
  for (const d of [...dated].sort((a, b) => b.taken.localeCompare(a.taken))) {
    const n = perSeries.get(d.series) ?? 0;
    if (n >= RECENT_PER_SERIES) continue;
    perSeries.set(d.series, n + 1);
    out.push(d.id);
    if (out.length === RECENT) break;
  }
  return out;
}

// The series to publish, in order: the AfterFrame import's galleries (sidebar order), each with its galleries.yaml
// entry applied, then the entries that publish a cache folder of their own (the hidden on-site archive).
async function seriesList(cacheDir, config, log) {
  const byCollection = new Map(config.galleries.filter((g) => g.collection).map((g) => [g.collection, g]));
  const out = [];
  const imported = JSON.parse(await readFile(path.join(cacheDir, "afterframe.json"), "utf8").catch(() => '{"galleries":[]}')).galleries;
  for (const g of imported) {
    const o = byCollection.get(g.collection) ?? {};
    byCollection.delete(g.collection);
    out.push({ tone: "auto", order: "best", ...o, slug: o.slug ?? g.slug, title: o.title ?? g.collection, source: g.slug });
  }
  for (const name of byCollection.keys()) log(`  galleries.yaml: collection "${name}" is not in the last AfterFrame import (ignored)`);
  for (const g of config.galleries) if (!g.collection) out.push(g);
  return out;
}

// What a link to the series shows when it is pasted into a chat or a post (og:image): the cover as a JPEG, since
// not every app that draws link previews reads WebP. Cut from the rendered rung, not the original; it lives next
// to the cover's other sizes as <id>/og.jpg and is uploaded with them.
async function shareImage(outDir, item, force) {
  const out = path.join(outDir, item.id, "og.jpg");
  if (force || !existsSync(out) || (await stat(out)).size === 0) {
    const from = path.join(outDir, item.id, `${item.sizes.find((s) => s >= SHARE_EDGE) ?? item.sizes.at(-1)}.webp`);
    await sharp(from).resize({ width: SHARE_EDGE, height: SHARE_EDGE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toFile(out);
  }
  const { width, height } = await sharp(out).metadata();
  return { w: width, h: height };
}

async function luminance(file) {
  try {
    const { channels } = await sharp(file).stats();
    const [r, g, b] = channels.map((c) => c.mean);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  } catch { return null; }
}
const median = (xs) => { if (!xs.length) return undefined; const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); return s[Math.floor(s.length / 2)]; };

// --mock placeholders (dev only): deterministic from the id so layouts can be judged before real data exists.
const MOCK_KITS = [
  { camera: "Canon EOS R5", lenses: [["RF 35mm F1.8", 35], ["RF 50mm F1.2 L", 50], ["RF 24-70mm F2.8 L", 24], ["RF 70-200mm F2.8 L", 135]] },
  { camera: "Sony α7R IV", lenses: [["FE 35mm F1.4 GM", 35], ["FE 85mm F1.4 GM", 85], ["FE 16-35mm F2.8 GM", 16], ["FE 200-600mm", 400]] },
  { camera: "Fujifilm X-T5", lenses: [["XF 23mm F1.4", 23], ["XF 56mm F1.2", 56], ["XF 16-55mm F2.8", 35]] },
];
const MOCK_APERTURES = [1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11];
const MOCK_SHUTTERS = ["1/4000", "1/2000", "1/1000", "1/500", "1/250", "1/125", "1/60", "1/15", "1/4", "2\"", "8\"", "30\""];
const MOCK_ISOS = [100, 200, 400, 800, 1600, 3200, 6400];

function mockExif(id, gallery) {
  const n = parseInt(id.slice(0, 8), 16) >>> 0; // unsigned, so the shifted indexes stay non-negative
  const kit = MOCK_KITS[hashStr(gallery.slug) % MOCK_KITS.length];
  const [lens, focal] = kit.lenses[n % kit.lenses.length];
  const night = gallery.tone === "dark";
  const year = gallery.year ?? 2021 + (hashStr(gallery.slug) % 4);
  return {
    camera: kit.camera,
    lens,
    focal,
    aperture: MOCK_APERTURES[(n >>> 3) % (night ? 4 : MOCK_APERTURES.length)],
    shutter: MOCK_SHUTTERS[night ? 5 + ((n >>> 6) % 7) : (n >>> 6) % 6],
    iso: MOCK_ISOS[night ? 3 + ((n >>> 9) % 4) : (n >>> 9) % 3],
    taken: `${year}-${String(1 + ((n >>> 12) % 12)).padStart(2, "0")}`,
  };
}

const MOCK_CENTERS = {
  "tokyo-night": [35.6586, 139.7454], shinjuku: [35.6938, 139.7034], "on-roppongi-hills": [35.6605, 139.7292], lights: [35.6762, 139.6503],
  "shanghai-i": [31.2304, 121.4737], "shanghai-ii": [31.2397, 121.4998],
  sanfrancisco: [37.7749, -122.4194], "sanfrancisco-sunset": [37.7599, -122.5085], "sanfrancisco-to": [37.7955, -122.3937], pacifica: [37.6138, -122.4869],
  "los-angeles-i": [34.0522, -118.2437], aviation: [37.6213, -122.379], newcastle: [54.9783, -1.6178], sunset: [37.8199, -122.4783],
  "amusement-park": [37.7716, -122.5176], "still-life-of-street": [35.7101, 139.8107],
};
function mockGeo(id, gallery) {
  const c = MOCK_CENTERS[gallery.slug];
  if (!c) return null;
  const n = parseInt(id.slice(4, 12), 16) >>> 0;
  const r = 0.012 * ((n & 0xff) / 255); // up to ~1.3 km
  const a = ((n >>> 8) & 0xfff) / 0xfff * Math.PI * 2;
  return { lat: +(c[0] + r * Math.sin(a)).toFixed(5), lng: +(c[1] + r * Math.cos(a) / Math.cos(c[0] * Math.PI / 180)).toFixed(5), precision: "exact" };
}

function hashStr(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function orientedSize(meta) {
  const swap = meta.orientation && meta.orientation >= 5;
  return swap ? [meta.height, meta.width] : [meta.width, meta.height];
}

async function runPool(tasks, n) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) { const t = tasks[i++]; await t(); }
  }));
}
