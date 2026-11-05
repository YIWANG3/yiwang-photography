#!/usr/bin/env node
// publish: the command-line entry for everything that turns curated photos into the site's inputs.
//   import-squarespace   pull the current Squarespace galleries into .cache/originals (stop-gap source)
//   render               originals → site/public/i/<id>/<w>.webp + site/src/data/manifest.json
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importSquarespace } from "../src/sources/squarespace.mjs";
import { render } from "../src/render.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const [cmd, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));

const paths = {
  root: ROOT,
  cacheDir: path.join(ROOT, ".cache", "originals"),
  galleries: path.join(ROOT, "content", "galleries.yaml"),
  outDir: path.join(ROOT, "site", "public", "i"),
  manifest: path.join(ROOT, "site", "src", "data", "manifest.json"),
};

try {
  if (cmd === "import-squarespace") {
    await importSquarespace({ origin: flags.origin || "https://yiwang.photography", cacheDir: paths.cacheDir });
  } else if (cmd === "render") {
    await render({ ...paths, imageBase: flags["image-base"] || "/i", force: Boolean(flags.force) });
  } else {
    console.error("usage: publish <import-squarespace|render> [--origin=URL] [--image-base=/i] [--force]");
    process.exit(2);
  }
} catch (err) {
  console.error(err.stack || String(err));
  process.exit(1);
}
