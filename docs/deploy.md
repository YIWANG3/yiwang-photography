# Deploying

The site is static HTML on **Cloudflare Pages**; the photos live in an **R2** bucket behind
`img.yiwang.photography`. One command does a release:

```bash
npm run deploy
```

It runs three steps (`publisher/src/deploy.mjs`):

1. **sync-images** – uploads every `site/public/i/<id>/<w>.webp` the bucket does not have yet.
   Images are content-addressed, so nothing is ever overwritten or deleted; old pages keep working
   during an upload and a rollback is just an older Pages deployment.
2. **build** – `astro build` with `PUBLIC_IMAGE_BASE=$IMAGE_BASE`, so every `<img>` points at the CDN.
   The dev copy of the images and the phone preview page are removed from `site/dist`.
3. **pages deploy** – `wrangler pages deploy site/dist` (direct upload, not a Git-integrated build,
   because `manifest.json` and the images are not in git).

`npm run sync-images` runs step 1 alone. Flags: `--dry-run` (list what would upload, build but do not
deploy), `--skip-images`, `--skip-pages`, `--branch=preview` (a non-production Pages branch gets its own
`*.pages.dev` preview URL).

Credentials come from the root `.env` (gitignored; template in `.env.example`).

## One-time setup

### 1. Cloudflare account and wrangler login

```bash
npx wrangler login
```

Opens the browser for OAuth. `npx wrangler whoami` confirms.

### 2. R2 bucket

Dashboard → R2 → *Create bucket*: name `yiwang-photos`, location hint **Asia-Pacific**.

- *Settings → Public access*: enable the `r2.dev` subdomain for now (it is rate-limited and meant for
  testing; the custom domain replaces it in step 5). Copy the URL into `.env` as `IMAGE_BASE`.
- *R2 → Manage R2 API Tokens → Create API token*: permission **Object Read & Write**, scoped to this
  bucket. Copy Access Key ID / Secret Access Key into `.env`; the account id is on the R2 overview page.

### 3. Pages project

```bash
npx wrangler pages project create yiwang-photography --production-branch main
```

### 4. First deploy

```bash
npm run deploy
```

First run uploads ~800 files / 165 MB, later runs only new photos. The site comes up at
`https://yiwang-photography.pages.dev`. The Google Maps key (`site/.env`, `PUBLIC_GOOGLE_MAPS_KEY`) is
baked into the build: add `*.pages.dev` and the real domain to that key's HTTP-referrer allow list in
the Google Cloud console or the map page will show a key error.

### 5. Domain

The domain is registered at Squarespace Domains and its DNS is on Squarespace. Moving DNS to Cloudflare
keeps the registration where it is.

1. Cloudflare dashboard → *Add a domain* → `yiwang.photography`, Free plan. It scans the existing
   records and shows two nameservers.
2. Squarespace → Domains → yiwang.photography → *DNS → Nameservers → Use custom nameservers*, paste the
   two Cloudflare nameservers. Propagation takes minutes to a few hours; `dig +short NS yiwang.photography`
   shows when it has flipped.
3. Pages → project → *Custom domains*: add `yiwang.photography` and `www.yiwang.photography`
   (Cloudflare creates the records). The old Squarespace A/CNAME records for the apex and `www` must go.
4. R2 → bucket → *Settings → Custom domains*: add `img.yiwang.photography`. Set
   `IMAGE_BASE=https://img.yiwang.photography` in `.env`, disable the `r2.dev` URL, `npm run deploy` again.
5. Once the new site answers on the domain, cancel the Squarespace **website** subscription (not the
   domain). Keep the Squarespace export until the AfterFrame source has replaced the importer.

### 6. Check mainland reachability

Run the domain through 17ce.com or boce.com. Cloudflare-proxied custom domains are usually reachable
from the mainland, `*.pages.dev` often is not, so test the real domain. If the image domain measures
badly, the fallback in `docs/plan.md` is a Tencent COS bucket in Hong Kong behind `img.` instead of R2;
the sync step is the only thing that changes.

## Costs

Pages: free (500 builds/month do not apply to direct uploads; unlimited bandwidth). R2: 10 GB storage and
10 M reads/month free, no egress fees; this site is ~0.2 GB. Domain stays at Squarespace (~$20/yr).
