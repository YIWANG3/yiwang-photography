// Shared shapes: what content/galleries.yaml may contain and what manifest.json promises the site.
import { z } from "zod";

export const Tone = z.enum(["light", "dark"]);

export const Link = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  icon: z.enum(["instagram", "xiaohongshu", "douyin", "map", "afterframe", "link"]).default("link"),
});

export const GalleriesConfig = z.object({
  site: z.object({
    title: z.string().min(1),
    links: z.array(Link).default([]),
    // newest_first: series by the date most of their photographs were taken, latest on top (a series without
    // dates needs `year` or goes last); afterframe: the sidebar order of the catalog.
    series_order: z.enum(["newest_first", "afterframe"]).default("newest_first"),
  }),
  // The AfterFrame app the import reads from. Every folder collection becomes a series unless skipped here.
  afterframe: z.object({
    port: z.number().int().default(41706),
    skip: z.array(z.string()).default([]),               // collection names that are not series
    skip_pattern: z.string().default("^\\d{6} "),      // regex: working folders by naming convention ("261108 …")
  }).default({}),
  // Display names for cameras and lenses as EXIF spells them ("Canon EOS R6m2" → "Canon EOS R6 Mark II").
  // Two raw names may share a display name; they are then one piece of equipment.
  equipment: z.record(z.string()).default({}),
  // Per-series presentation. An entry with `collection` adjusts that AfterFrame collection (defaults: slug and
  // title from its name, tone by brightness); an entry with `source` publishes a cache folder of its own.
  galleries: z.array(z.object({
    collection: z.string().min(1).optional(), // AfterFrame collection name, exact
    source: z.string().optional(),            // cache folder (on-site) when there is no collection
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case").optional(),
    title: z.string().min(1).optional(),
    year: z.number().int().optional(),
    place: z.string().optional(),             // city/region, stands in for photos without an address
    // Where the series was made, for photos whose file carries no GPS: they go on the map here, marked approximate.
    // Without it, a series whose other photos have GPS uses their centre.
    location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), precision: z.enum(["landmark", "locality", "admin1"]).default("landmark") }).optional(),
    tone: z.enum(["light", "dark", "auto"]).default("auto"),
    // best: the photos flagged P in AfterFrame first, then the rest, each by capture time; captured_*: time only;
    // manual: as AfterFrame lists them
    order: z.enum(["best", "captured_asc", "captured_desc", "manual"]).default("best"),
    cover: z.string().optional(),             // file stem
    description: z.string().optional(),
    hidden: z.boolean().optional(),
  }).refine((g) => g.collection || (g.source && g.slug && g.title), { message: "an entry needs a collection, or source + slug + title" })).default([]),
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
  precision: z.enum(["exact", "landmark", "locality", "admin1", "country"]).default("exact"), // landmark = a building or park

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
  place: z.string().nullable().default(null),   // "Monterey, California": from the source, shown with the photo
  taken: z.string().nullable().default(null),   // ISO timestamp when known (sorting, never shown finer than YYYY-MM)
  mock: z.boolean().default(false),             // exif/geo are --mock placeholders (dev builds only)
});

export const Manifest = z.object({
  version: z.literal(1),
  generated_at: z.string(),
  site: z.object({ title: z.string(), image_base: z.string(), exif_mock: z.boolean().default(false), geo_mock: z.boolean().default(false), links: z.array(Link).default([]) }),
  galleries: z.array(z.object({
    slug: z.string(), title: z.string(), year: z.number().nullable(), place: z.string().nullable(), tone: Tone,
    gear: z.array(z.string()).default([]),   // one row per camera, paired with its actual lenses
    description: z.string(), hidden: z.boolean(), cover: z.string(), count: z.number().int(),
    items: z.array(Item).min(1),
  })),
  recent: z.array(z.string()),
});
