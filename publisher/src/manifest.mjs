// Shared shapes: what content/galleries.yaml may contain and what manifest.json promises the site.
import { z } from "zod";

export const Tone = z.enum(["light", "dark"]);

export const Link = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  icon: z.enum(["instagram", "xiaohongshu", "map", "afterframe", "link"]).default("link"),
});

export const GalleriesConfig = z.object({
  site: z.object({ title: z.string().min(1), links: z.array(Link).default([]) }),
  galleries: z.array(z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case"),
    title: z.string().min(1),
    collection: z.string().optional(),   // AfterFrame collection name (exact), unused by the Squarespace source
    source: z.string().optional(),       // cache folder when it differs from slug
    year: z.number().int().optional(),
    place: z.string().optional(),       // groups series in the left index
    tone: Tone.default("light"),
    order: z.enum(["captured_asc", "captured_desc", "manual"]).default("captured_asc"),
    cover: z.string().optional(),        // file stem
    description: z.string().optional(),
    hidden: z.boolean().optional(),
  })),
});

export const Exif = z.object({
  camera: z.string().optional(),
  lens: z.string().optional(),
  focal: z.number().optional(),
  aperture: z.number().optional(),
  shutter: z.string().optional(),
  iso: z.number().optional(),
  taken: z.string().optional(),          // YYYY-MM, never finer
}).nullable();

export const Geo = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  precision: z.enum(["exact", "locality", "admin1", "country"]).default("exact"),
}).nullable();

export const Item = z.object({
  id: z.string().length(12),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  shape: z.enum(["landscape", "portrait", "square"]),
  sizes: z.array(z.number().int().positive()).min(1),
  alt: z.string(),
  exif: Exif,
  geo: Geo.default(null),
});

export const Manifest = z.object({
  version: z.literal(1),
  generated_at: z.string(),
  site: z.object({ title: z.string(), image_base: z.string(), exif_mock: z.boolean().default(false), geo_mock: z.boolean().default(false), links: z.array(Link).default([]) }),
  galleries: z.array(z.object({
    slug: z.string(), title: z.string(), year: z.number().nullable(), place: z.string().nullable(), tone: Tone,
    description: z.string(), hidden: z.boolean(), cover: z.string(), count: z.number().int(),
    items: z.array(Item).min(1),
  })),
  recent: z.array(z.string()),
});
