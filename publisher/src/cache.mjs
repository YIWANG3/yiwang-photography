// The originals cache: .cache/originals/<slug>/index.json per source, read by render and the on-site matcher.
// An item points at its image either as `file` (relative to the source's folder, the on-site download) or
// as `path` (an absolute path on the user's disks, the AfterFrame source: nothing is copied).
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export async function readIndex(cacheDir, slug) {
  const p = path.join(cacheDir, slug, "index.json");
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, "utf8"));
}

export const itemPath = (cacheDir, index, it) => it.path ?? path.join(cacheDir, index.slug, it.file);

// dHash bits ⇄ hex, the form indexes store.
export const toHex = (bits) => { let s = ""; for (let i = 0; i < bits.length; i += 4) s += (bits[i] * 8 + bits[i + 1] * 4 + bits[i + 2] * 2 + bits[i + 3]).toString(16); return s; };
export const fromHex = (hex) => { const b = new Uint8Array(hex.length * 4); for (let i = 0; i < hex.length; i++) { const v = parseInt(hex[i], 16); b[i * 4] = v >> 3 & 1; b[i * 4 + 1] = v >> 2 & 1; b[i * 4 + 2] = v >> 1 & 1; b[i * 4 + 3] = v & 1; } return b; };
