# yiwang.photography

Static portfolio site plus the publisher that turns curated photos into the site's inputs.
AfterFrame stays read-only: it is where photos are selected; everything about publishing lives here.

## Run locally

```bash
npm install
npm run import               # AfterFrame must be open: its folder collections → .cache/originals/<slug>/index.json
npm run import:onsite        # one-time: the on-site.photos archive (real GPS, address, EXIF) → .cache/originals/on-site
npm run render               # originals → site/public/i/<id>/<w>.webp (+ og.jpg per cover, for link previews) + site/src/data/manifest.json (--mock for placeholders)
npm run dev                  # http://127.0.0.1:4321
```

`npm run import` talks to the running AfterFrame app over MCP (port 41706; `AFTERFRAME_MCP_PORT` or
`afterframe.port` in galleries.yaml for a dev build). Every folder collection of the open catalog is a series,
in the sidebar's order, titled by its name; the originals stay on disk and are read once each (content hash,
size, perceptual hash, EXIF with GPS), so a second import only touches new photos. Photos flagged **P** in
AfterFrame open their series (the first one is the cover); the rest follow by capture time. Publishing a new
series = make a collection in AfterFrame, then `npm run import && npm run render && npm run deploy`.
`npm run sync-images -- --prune` (after a deploy) deletes images the current site no longer references from
the bucket and the local render folder; `--dry-run` only counts them.

## Deploy

```bash
npm run deploy               # images → R2, astro build against the CDN, dist → Cloudflare Pages
```

Needs the root `.env` (see `.env.example`) and `npx wrangler login`. Setup, domain move and the
mainland-reachability check are in `docs/deploy.md`.

`content/galleries.yaml` holds what the site adds on top: collections to skip, display names for cameras and
lenses (the series header names the equipment once), and per-series overrides (slug, title, tone, cover,
description, and `zh: { title, place }` for the Chinese text). The site is bilingual at the same URLs: both
texts are in every page and `<html data-lang>` (the switch in the sidebar, else the browser language) picks one;
interface strings live in `site/src/i18n/ui.js` and the `L` component. A series' page is dark when its photographs are, unless `tone` says otherwise. Photos exported
without EXIF show no data; the on-site.photos archive (334 photographs with real GPS and addresses) is map-only,
and the ones that are also gallery photos are published once, as that gallery photo, with that data.
`npm run render -- --mock` fills missing data with placeholders for layout work; the site then says so.

## Layout

- `site/` Astro static site (pages, lightbox, theme toggle)
- `publisher/` CLI: sources (AfterFrame over MCP, the on-site archive), EXIF reader, sharp render, manifest schema
- `content/` galleries.yaml and about copy
- `docs/plan.md` architecture, infrastructure, phases; `docs/design-research.md` reference sites and direction;
  `docs/prototypes/design-review.html` the published design review

Decisions so far (2026-10-16): archive-style layout, both light and dark themes, originals never public,
EXIF shown, Cloudflare Pages + R2 first, presets store dropped. Domain is registered at Squarespace Domains (Tucows), expires 2027-10-29.
