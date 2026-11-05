// deploy: rendered images → R2, built site → Cloudflare Pages.
// Images are content-addressed (publisher/src/render.mjs), so the sync only ever adds objects and never
// overwrites or deletes: an old deploy keeps working while a new one uploads, and rollbacks are free.
import { readdir, readFile, stat, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { S3Client, ListObjectsV2Command, PutObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

const UPLOAD_CONCURRENCY = 8;
const IMMUTABLE = "public, max-age=31536000, immutable";

export function r2Client({ accountId, accessKeyId, secretAccessKey }) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

// Upload every <id>/<w>.webp under `dir` that the bucket does not have yet. Returns counts.
export async function syncImages({ dir, bucket, client, dryRun = false, log = console.log }) {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  const local = await listLocal(dir);
  const remote = await listRemote(client, bucket);
  const missing = local.filter((k) => !remote.has(k));
  log(`images: ${local.length} local, ${remote.size} in r2://${bucket}, ${missing.length} to upload`);
  if (dryRun || missing.length === 0) return { local: local.length, remote: remote.size, uploaded: 0 };

  let done = 0, bytes = 0;
  await runPool(missing.map((key) => async () => {
    const file = path.join(dir, key);
    const body = await readFile(file);
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: body,
      ContentType: contentType(key), CacheControl: IMMUTABLE,
    }));
    done++; bytes += body.length;
    if (done % 50 === 0 || done === missing.length) log(`  ${done}/${missing.length} uploaded (${(bytes / 1e6).toFixed(1)} MB)`);
  }), UPLOAD_CONCURRENCY);
  return { local: local.length, remote: remote.size, uploaded: done };
}

// Build the site with the production image base, then push dist/ to Pages with wrangler.
export async function buildSite({ root, imageBase, log = console.log }) {
  log(`site: building with PUBLIC_IMAGE_BASE=${imageBase}`);
  await run("npm", ["run", "build", "-w", "site"], { cwd: root, env: { ...process.env, PUBLIC_IMAGE_BASE: imageBase } });
  // site/public/i is the dev copy of the images; production reads them from R2, so keep them out of the Pages upload.
  await rm(path.join(root, "site", "dist", "i"), { recursive: true, force: true });
  await rm(path.join(root, "site", "dist", "_phone.html"), { force: true }); // dev-only phone preview
  log("site: built site/dist (images excluded, served from the CDN)");
}

export async function deployPages({ root, project, branch = "main", log = console.log }) {
  log(`pages: deploying site/dist to project "${project}" (${branch})`);
  await run("npx", ["wrangler", "pages", "deploy", "site/dist", "--project-name", project, "--branch", branch, "--commit-dirty=true"], { cwd: root });
}

async function listLocal(dir) {
  const keys = [];
  for (const id of await readdir(dir)) {
    const sub = path.join(dir, id);
    if (!(await stat(sub)).isDirectory()) continue;
    for (const f of await readdir(sub)) if (f.endsWith(".webp")) keys.push(`${id}/${f}`);
  }
  return keys.sort();
}

async function listRemote(client, bucket) {
  const keys = new Set();
  let ContinuationToken;
  do {
    const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken }));
    for (const o of res.Contents ?? []) keys.add(o.Key);
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

function contentType(key) {
  return key.endsWith(".webp") ? "image/webp" : key.endsWith(".json") ? "application/json" : "application/octet-stream";
}

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))));
  });
}

async function runPool(tasks, n) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) { const t = tasks[i++]; await t(); }
  }));
}
