#!/usr/bin/env node
// publish: the command-line entry for everything that turns curated photos into the site's inputs.
//   import-squarespace   pull the current Squarespace galleries into .cache/originals (stop-gap source)
//   import-onsite        pull the on-site.photos posts + originals into .cache/originals/on-site (real GPS/EXIF)
//   render               originals → site/public/i/<id>/<w>.webp + site/src/data/manifest.json (--mock: placeholders)
//   sync-images          upload rendered images the R2 bucket does not have yet
//   deploy               sync-images, build the site against the image CDN, push dist/ to Cloudflare Pages
// Credentials and deploy targets come from the root .env (see .env.example); flags override.
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { importSquarespace } from "../src/sources/squarespace.mjs";
import { importOnsite, ONSITE_SLUG } from "../src/sources/onsite.mjs";
import { render } from "../src/render.mjs";
import YAML from "yaml";
import { r2Client, syncImages, buildSite, deployPages } from "../src/deploy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const [cmd, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
loadDotenv(path.join(ROOT, ".env"));

const paths = {
  root: ROOT,
  cacheDir: path.join(ROOT, ".cache", "originals"),
  galleries: path.join(ROOT, "content", "galleries.yaml"),
  outDir: path.join(ROOT, "site", "public", "i"),
  manifest: path.join(ROOT, "site", "src", "data", "manifest.json"),
};

const env = (key, fallback) => process.env[key] ?? fallback;
const deployTarget = () => ({
  bucket: env("R2_BUCKET", "yiwang-photos"),
  imageBase: env("IMAGE_BASE"),
  project: env("PAGES_PROJECT", "yiwang-photography"),
  branch: flags.branch || env("PAGES_BRANCH", "main"),
  r2: { accountId: env("R2_ACCOUNT_ID"), accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") },
});

try {
  if (cmd === "import-squarespace") {
    await importSquarespace({ origin: flags.origin || "https://yiwang.photography", cacheDir: paths.cacheDir });
  } else if (cmd === "import-onsite") {
    const serverEnv = flags["server-env"] || env("ONSITE_SERVER_ENV");
    if (!serverEnv) throw new Error("ONSITE_SERVER_ENV (path to the old photo-location-server .env) is not set");
    const config = YAML.parse(readFileSync(paths.galleries, "utf8"));
    const sqSources = config.galleries.map((g) => g.source ?? g.slug).filter((s) => s !== ONSITE_SLUG);
    await importOnsite({ cacheDir: paths.cacheDir, serverEnv, sqSources });
  } else if (cmd === "render") {
    await render({ ...paths, imageBase: flags["image-base"] || "/i", force: Boolean(flags.force), mock: Boolean(flags.mock) });
  } else if (cmd === "sync-images" || cmd === "deploy") {
    const t = deployTarget();
    if (!flags["skip-images"]) {
      requireEnv(t.r2, ["accountId", "accessKeyId", "secretAccessKey"], "R2_");
      await syncImages({ dir: paths.outDir, bucket: t.bucket, client: r2Client(t.r2), dryRun: Boolean(flags["dry-run"]) });
    }
    if (cmd === "deploy") {
      if (!t.imageBase) throw new Error("IMAGE_BASE is not set (the public URL of the R2 bucket, e.g. https://img.yiwang.photography)");
      await buildSite({ root: ROOT, imageBase: t.imageBase });
      if (!flags["skip-pages"] && !flags["dry-run"]) await deployPages({ root: ROOT, project: t.project, branch: t.branch });
    }
  } else {
    console.error("usage: publish <import-squarespace|import-onsite|render|sync-images|deploy> [--origin=URL] [--server-env=PATH] [--image-base=/i] [--force] [--mock] [--dry-run] [--skip-images] [--skip-pages] [--branch=main]");
    process.exit(2);
  }
} catch (err) {
  console.error(err.stack || String(err));
  process.exit(1);
}

function loadDotenv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

function requireEnv(obj, keys, prefix) {
  const missing = keys.filter((k) => !obj[k]);
  if (missing.length) throw new Error(`missing in .env: ${missing.map((k) => prefix + k.replace(/([A-Z])/g, "_$1").toUpperCase()).join(", ")}`);
}
