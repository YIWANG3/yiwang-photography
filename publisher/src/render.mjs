// render: originals → content-addressed WebP ladder + manifest.json.
// Rules (docs/plan.md §4.3): auto-rotate, convert to sRGB and strip metadata (sharp's default), never enlarge,
// ladder 480/1200/2000/3200 plus the source's own long edge when it falls between rungs, q80 for 480 and q82 above.
// Camera data and coordinates come from the source index (on-site.photos, later AfterFrame); photos without any
// get null, or placeholders when --mock is passed (dev only: the site says so in the legend).
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import YAML from "yaml";
import { GalleriesConfig, Manifest } from "./manifest.mjs";
import { readIndex } from "./sources/squarespace.mjs";
import { readOnsiteOverrides } from "./sources/onsite.mjs";

export const RENDER_VERSION = 1;
const LADDER = [480, 1200, 2000, 3200];
const CONCURRENCY = 4;

export async function render({ cacheDir, galleries: galleriesPath, outDir, manifest: manifestPath, imageBase, force, mock = false, log = console.log }) {
  const config = GalleriesConfig.parse(YAML.parse(await readFile(galleriesPath, "utf8")));
  await mkdir(outDir, { recursive: true });
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const overrides = await readOnsiteOverrides(cacheDir);

  const galleries = [];
  const recent = [];
  let rendered = 0, reused = 0, mocked = 0;

  for (const g of config.galleries) {
    const index = await readIndex(cacheDir, g.source ?? g.slug);
    if (!index) { log(`  ${g.slug}: no originals in cache, skipped`); continue; }
    // An on-site image that is also a gallery photo is published once, as that gallery photo.
    const sourceItems = index.items.filter((it) => !it.match);
    const items = new Array(sourceItems.length);
    await runPool(sourceItems.map((it, i) => async () => {
      const file = path.join(cacheDir, index.slug, it.file);
      const buf = await readFile(file);
      const id = createHash("sha1").update(buf).update(`v${RENDER_VERSION}`).digest("hex").slice(0, 12);
      const dir = path.join(outDir, id);
      const img = sharp(buf, { failOn: "none" }).rotate();
      const meta = await img.metadata();
      const [w, h] = orientedSize(meta);
      const longEdge = Math.max(w, h);
      const sizes = LADDER.filter((s) => s < longEdge);
      if (sizes.length === 0 || longEdge - sizes[sizes.length - 1] > 200) sizes.push(longEdge);
      const outputs = [];
      for (const s of sizes) {
        const out = path.join(dir, `${s}.webp`);
        if (!force && existsSync(out) && (await stat(out)).size > 0) { reused++; outputs.push(s); continue; }
        await mkdir(dir, { recursive: true });
        let pipe = sharp(buf, { failOn: "none" }).rotate().resize({ width: s, height: s, fit: "inside", withoutEnlargement: true });
        if (s <= 1200) pipe = pipe.sharpen({ sigma: 0.6 });
        await pipe.webp({ quality: s <= 480 ? 80 : 82, effort: 4 }).toFile(out);
        rendered++;
        outputs.push(s);
      }
      // Real data: the item's own (on-site source) or the on-site match for this gallery photo.
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
        place: real?.place ?? null,
        taken: real?.taken ?? null,
        mock: isMock,
      };
    }), CONCURRENCY);

    if (g.order === "captured_desc") items.reverse();
    const coverId = g.cover ? items.find((it, i) => sourceItems[i].stem === g.cover)?.id : undefined;
    galleries.push({
      slug: g.slug, title: g.title, year: g.year ?? null, place: g.place ?? null, tone: g.tone, description: g.description ?? "",
      hidden: g.hidden ?? false, cover: coverId ?? items[0].id, count: items.length, items,
    });
    if (!g.hidden) recent.push(...items.slice(0, 3).map((it) => it.id));
    log(`  ${g.slug}: ${items.length} photos${g.hidden ? " (hidden)" : ""}, ${items.filter((it) => it.geo && !it.mock).length} with real location`);
  }

  const manifest = Manifest.parse({
    version: 1,
    generated_at: new Date().toISOString(),
    site: { title: config.site.title, image_base: imageBase, exif_mock: mocked > 0, geo_mock: mocked > 0, links: config.site.links },
    galleries,
    recent,
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 1));
  const all = galleries.flatMap((g) => g.items);
  log(`manifest: ${galleries.length} galleries, ${all.length} photos (${all.filter((it) => it.geo && !it.mock).length} located, ${mocked} mocked); rendered ${rendered}, reused ${reused} files → ${path.relative(process.cwd(), manifestPath)}`);
}

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
