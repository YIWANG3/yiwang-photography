// The site reads one file. In production the publisher uploads manifest.json next to the images and the
// build fetches it; locally `publish render` writes it here. Either way the shape is publisher/src/manifest.mjs.
import manifest from "../data/manifest.json";

// PUBLIC_IMAGE_BASE (set by `publish deploy`) points the build at the image CDN; the manifest's own value is for dev.
export const site = { ...manifest.site, image_base: import.meta.env.PUBLIC_IMAGE_BASE || manifest.site.image_base };
export const galleries = manifest.galleries.filter((g) => !g.hidden);
export const allGalleries = manifest.galleries;
export const recentIds = manifest.recent;

const byId = new Map();
for (const g of manifest.galleries) for (const it of g.items) byId.set(it.id, { ...it, gallery: g });
export const itemById = (id) => byId.get(id);

export function src(item, w) {
  return `${site.image_base}/${item.id}/${w}.webp`;
}
export function srcset(item) {
  return item.sizes.map((w) => `${src(item, w)} ${w}w`).join(", ");
}
// The cover as a JPEG for link previews (og:image), with its size; null when the series has none.
export function shareImage(g) {
  return g?.share ? { url: `${site.image_base}/${g.cover}/og.jpg`, ...g.share } : null;
}
// What a photograph is, in words, for readers who cannot see it and for image search: the series and where it
// was taken, once ("Lands End II" in "Lands End, San Francisco" is just the place). A caption of its own wins.
export function altText(item, g, { title = g.title, place = item.place ?? g.place } = {}) {
  if (item.alt) return item.alt;
  if (!place) return title;
  const bare = title.replace(/\s+[IVX]+$/, "").toLowerCase();
  return place.toLowerCase().includes(bare) ? place : `${title}, ${place}`;
}
export function largest(item) {
  return item.sizes[item.sizes.length - 1];
}
export function pick(item, targetWidth) {
  return item.sizes.find((w) => w >= targetWidth) ?? largest(item);
}

// The year most of a series was taken, when its photographs carry dates (galleries.yaml's year wins).
export function yearOf(items) {
  const n = new Map();
  for (const it of items) { const y = (it.exif?.taken || it.taken || "").slice(0, 4); if (/^\d{4}$/.test(y)) n.set(y, (n.get(y) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// The exposure triplet on its own, for captions.
export function exposure(exif) {
  if (!exif) return "";
  const exp = [];
  if (exif.focal) exp.push(`${exif.focal}mm`);
  if (exif.aperture) exp.push(`ƒ/${exif.aperture}`);
  if (exif.shutter) exp.push(`${exif.shutter}s`.replace('"s', '"'));
  if (exif.iso) exp.push(`ISO ${exif.iso}`);
  return exp.join(" · ");
}
// Everything the lightbox and the map show under a photo: place, exposure, month. The equipment is named
// once per series (gear), not under every photograph.
export function detailLine(item, place = item.place) {
  return [place, ...exifLine(item.exif)].filter(Boolean).join(" · ");
}

export function exifLine(exif) {
  if (!exif) return [];
  const parts = [];
  const exp = [];
  if (exif.focal) exp.push(`${exif.focal}mm`);
  if (exif.aperture) exp.push(`ƒ/${exif.aperture}`);
  if (exif.shutter) exp.push(`${exif.shutter}s`.replace('"s', '"'));
  if (exif.iso) exp.push(`ISO ${exif.iso}`);
  if (exp.length) parts.push(exp.join(" · "));
  if (exif.taken) parts.push(exif.taken);
  return parts;
}
