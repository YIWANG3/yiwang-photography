# yiwang.photography

Static portfolio site plus the publisher that turns curated photos into the site's inputs.
AfterFrame stays read-only: it is where photos are selected; everything about publishing lives here.

## Run the prototype locally

```bash
npm install
npm run import:squarespace   # one-time: pulls the current Squarespace galleries into .cache/originals (2500 px, no EXIF)
npm run import:onsite        # one-time: the on-site.photos archive (real GPS, address, EXIF) → .cache/originals/on-site
npm run import:originals     # find each gallery photo's exported original on local disks (Spotlight + hash) and keep its EXIF
npm run render               # originals → site/public/i/<id>/<w>.webp + site/src/data/manifest.json (--mock for placeholders)
npm run dev                  # http://127.0.0.1:4321
```

## Deploy

```bash
npm run deploy               # images → R2, astro build against the CDN, dist → Cloudflare Pages
```

Needs the root `.env` (see `.env.example`) and `npx wrangler login`. Setup, domain move and the
mainland-reachability check are in `docs/deploy.md`.

`content/galleries.yaml` decides which series exist, their order, titles and `tone` (light / dark page).
Squarespace exports carry no EXIF or GPS, so those photos show none; the on-site.photos import supplies real
data for its 334 photographs (11 of them are also gallery photos and are published once, with that data).
`npm run render -- --mock` fills the rest with placeholders for layout work; the site then says so.

## Layout

- `site/` Astro static site (pages, lightbox, theme toggle)
- `publisher/` CLI: sources (Squarespace now, AfterFrame MCP next), sharp render, manifest schema
- `content/` galleries.yaml and about copy
- `docs/plan.md` architecture, infrastructure, phases; `docs/design-research.md` reference sites and direction;
  `docs/prototypes/design-review.html` the published design review

Decisions so far (2026-10-16): archive-style layout, both light and dark themes, originals never public,
EXIF shown, Cloudflare Pages + R2 first, presets store dropped. Domain is registered at Squarespace Domains (Tucows), expires 2027-10-29.
