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
export function largest(item) {
  return item.sizes[item.sizes.length - 1];
}
export function pick(item, targetWidth) {
  return item.sizes.find((w) => w >= targetWidth) ?? largest(item);
}

export function exifLine(exif) {
  if (!exif) return [];
  const parts = [];
  if (exif.camera) parts.push(exif.camera);
  if (exif.lens) parts.push(exif.lens);
  const exp = [];
  if (exif.focal) exp.push(`${exif.focal}mm`);
  if (exif.aperture) exp.push(`ƒ/${exif.aperture}`);
  if (exif.shutter) exp.push(`${exif.shutter}s`.replace('"s', '"'));
  if (exif.iso) exp.push(`ISO ${exif.iso}`);
  if (exp.length) parts.push(exp.join(" · "));
  if (exif.taken) parts.push(exif.taken);
  return parts;
}
