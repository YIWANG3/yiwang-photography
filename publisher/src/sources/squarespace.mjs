// One-time source adapter: pulls the galleries of the current Squarespace site into .cache/originals.
// Squarespace serves at most 2500 px wide and strips EXIF, so these files are a stop-gap until the
// AfterFrame source replaces them. The output layout is the same as the AfterFrame source will write.
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const UA = "Mozilla/5.0 (Macintosh) yiwang-photography-importer";
const CONCURRENCY = 6;

export async function importSquarespace({ origin, cacheDir, skipSlugs = [], log = console.log }) {
  const home = await fetchText(origin + "/");
  const slugs = [...new Set([...home.matchAll(/href="\/([a-z0-9-]+)"/g)].map((m) => m[1]))]
    .filter((s) => !["cart", "search", "presets"].includes(s) && !skipSlugs.includes(s));
  log(`found ${slugs.length} gallery pages on ${origin}`);

  const galleries = [];
  for (const slug of slugs) {
    const html = await fetchText(`${origin}/${slug}`);
    const items = extractImages(html);
    if (items.length === 0) { log(`  ${slug}: no gallery images, skipped`); continue; }
    const dir = path.join(cacheDir, slug);
    await mkdir(dir, { recursive: true });
    const index = [];
    await runPool(items.map((it, i) => async () => {
      const stem = path.basename(it.url).replace(/\.[a-z0-9]+$/i, "");
      const file = `${String(i + 1).padStart(3, "0")}-${stem}.jpg`;
      const dest = path.join(dir, file);
      if (!existsSync(dest) || (await stat(dest)).size === 0) {
        const res = await fetch(it.url + "?format=2500w", { headers: { "user-agent": UA, accept: "image/jpeg,*/*" } });
        if (!res.ok) throw new Error(`${res.status} ${it.url}`);
        await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      }
      index[i] = { file, source: it.url, stem, width: it.width, height: it.height, alt: it.alt };
    }), CONCURRENCY);
    await writeFile(path.join(dir, "index.json"), JSON.stringify({ slug, items: index }, null, 2));
    galleries.push({ slug, count: items.length });
    log(`  ${slug}: ${items.length} photos`);
  }
  return galleries;
}

function extractImages(html) {
  // Squarespace gallery <img> tags carry data-src and data-image-dimensions in either order.
  const out = [];
  const seen = new Set();
  const re = /<img\b[^>]*>/g;
  for (const m of html.matchAll(re)) {
    const tag = m[0];
    const src = /data-src="(https:\/\/images\.squarespace-cdn\.com\/content\/v1\/[^"]+)"/.exec(tag)?.[1];
    const dims = /data-image-dimensions="(\d+)x(\d+)"/.exec(tag);
    if (!src || !dims || seen.has(src)) continue;
    seen.add(src);
    const alt = /\balt="([^"]*)"/.exec(tag)?.[1] ?? "";
    out.push({ url: src, width: Number(dims[1]), height: Number(dims[2]), alt: decode(alt) });
  }
  return out;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function runPool(tasks, n) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) { const t = tasks[i++]; await t(); }
  });
  await Promise.all(workers);
}

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export async function readIndex(cacheDir, slug) {
  const p = path.join(cacheDir, slug, "index.json");
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, "utf8"));
}
