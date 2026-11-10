// The sitemap: every page, and under each series its photographs (Google's image extension), so image search can
// find them with the page they belong to. Hidden series are left out.
import { galleries, src, pick, altText } from "../lib/data.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

export function GET({ site }) {
  const abs = (p) => new URL(p, site).href;
  const url = (p, images = []) => `<url><loc>${esc(abs(p))}</loc>${images.map((i) => `<image:image><image:loc>${esc(abs(i.loc))}</image:loc><image:title>${esc(i.title)}</image:title></image:image>`).join("")}</url>`;
  const body = [
    url("/"), url("/recent/"), url("/map/"), url("/about/"),
    ...galleries.map((g) => url(`/${g.slug}/`, g.items.map((it) => ({ loc: src(it, pick(it, 2000)), title: altText(it, g) })))),
  ].join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${body}\n</urlset>\n`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
