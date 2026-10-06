# hoteldemo — hotel website + admin CMS

A self-contained hotel website with a passphrase-protected admin panel. Everything on the public
site — text, photos, suites, rates, amenities, local-area guide, reviews, FAQ, colors, fonts, menu,
section order — is edited from `/admin` and stored in one JSON file. No database, no build step.

* **Live:** https://hoteldemo1.signaturediversified.com
* **Admin:** https://hoteldemo1.signaturediversified.com/admin — passphrase `hoteldemo`
* **Superadmin (vendor-only plan/feature control):** https://hoteldemo1.signaturediversified.com/superadmin — passphrase `hotelsuper`
* **Server path:** `/home/dad/wwwhotel/hoteldemosite` (runs under pm2 as `hoteldemo` on port 8097)

Default content is for **Budget Suites Extended Stay, 537 S Country Club Dr, Mesa, AZ 85210**.
Name, address, phone and 24-hour office hours came from public directory listings; room details,
rates and policies are placeholders to confirm in the admin panel.

---

## Stack

| Layer | Choice |
|---|---|
| Server | Node.js 18+ · Express 4 · EJS templates (server-rendered pages) |
| Styling | Tailwind CSS (vendored runtime in `public/vendor/`, so no build and no CDN dependency) + `public/css/site.css` |
| Data | `data/site.json` (live), `data/defaults.json` (default content), `data/blank.json`, `data/samples/*.json` |
| Admin | Vanilla-JS schema-driven editor (`public/admin/admin.js`) talking to `/admin/api/*` |
| Auth | Two independent passphrases → HMAC-signed httpOnly cookies (12 h), rate-limited: hotel admin (`/admin`) and vendor superadmin (`/superadmin`). A superadmin session can also open `/admin`. |
| Plan/features | `data/features.json` (live, git-ignored) via `src/features.js` — per-feature on/off + numeric limits, enforced server-side and mirrored as locked panels in the admin UI |
| Uploads | `multer` → `public/uploads/` (images only, 12 MB max) |
| Process | pm2 (`ecosystem.config.cjs`) · Cloudflare Tunnel → `127.0.0.1:8097` |

## Quick start (any machine)

```bash
git clone https://github.com/xmindpingx/hoteldemo.git
cd hoteldemo
npm install
npm start            # → http://localhost:8097   (admin: /admin, passphrase: hoteldemo)
```

`npm run dev` restarts on file changes. On first start `data/site.json` is created from
`data/defaults.json`.

## Admin panel

Open `/admin`, enter **`hoteldemo`**. Sections in the sidebar:

| Section | What you can change |
|---|---|
| General & Contact Info | Hotel name, location line, brand line, tagline, logo, phone, email, address, check-in/out, rating badge, booking mode (inquiry form vs. external booking URL), currency, announcement bar |
| Theme & Fonts | Primary + accent colors, heading/body fonts (Google Fonts list), header style, button shape, hero darkness, custom CSS |
| SEO Wizard | 9 steps: Basics (site URL, category, title patterns), Pages & Previews (per-page titles/descriptions with live search-result preview), Social Cards, Structured Data (JSON-LD), Local SEO, Search Engines (robots, sitemap, verification), Analytics (GA4/GTM/Pixel/Clarity), Hosting & Redirects (GoDaddy DNS guidance, 301 rules), Audit & Score |
| Navigation | Menu items (label, link, on/off) |
| Home Page Layout | Drag-free ordering of home-page sections; remove/add sections |
| Hero Banner | Badge, heading, subheading, buttons, slideshow images, booking bar on/off |
| Offers & Promotions | Promo cards (title, text, code, button, style) |
| Overview | Paragraphs, side image, icon highlights, stat boxes |
| Suites & Rooms | Full room editor: photos, beds, size, sleeps, features, price-from, notes, featured/visible |
| Amenities & Policies | Featured amenity cards, checklists by category, policy blocks |
| Dining | On-site food services + nearby restaurants |
| Local Area & Map | Map (address query or custom Google embed URL), attraction cards with categories/filters, airports, transport |
| Gallery | Drag-and-drop multi-upload, captions, categories (filter buttons + lightbox on the site) |
| Guest Reviews | Reviews list (off by default — add real reviews, then enable) |
| FAQ | Question/answer accordion |
| Contact Page | Heading, intro, form on/off, success message, hours, map on/off |
| Custom Sections | Raw HTML blocks placed anywhere on the home page or sub-pages |
| Footer | About text, links, social icons, copyright (`{year}`), admin-link toggle |
| Inquiries | Contact-form submissions (read/unread, delete) |
| Media Library | Uploaded images: copy URL, open, delete |
| Data, Reset & Security | Load datasets, replace a single section, export/import JSON, restore automatic backups, change passphrase |

Every list item has **move up/down, duplicate, delete, visible on/off**, and every list has
**Remove all**. Press **Save changes** (or `Ctrl/Cmd + S`); changes are live immediately.

### Removing or restoring the sample/mock data

In **Data, Reset & Security**:

* **Wipe everything (blank site)** — removes all content and leaves a neutral skeleton
  ("Your Hotel Name", empty lists) so you can populate it from scratch.
* **Restore default content** — the Budget Suites dataset.
* **Load sample: Desert Sage Suites** — a fictional upscale extended-stay dataset (pool, breakfast,
  sport court, sample reviews) for demos.
* **Replace section** — swap just one section (e.g. only *Local Area*) from any dataset.

Every save writes a backup to `data/backups/` (last 30 kept) and backups can be restored from the
same page. You can also run `npm run reset:blank` / `npm run reset:mock` on the server.

### Passphrase

Default is `hoteldemo`. Change it under *Data, Reset & Security* (stored hashed in `data/admin.json`),
or the vendor can reset it from `/superadmin` without knowing the current one. To force a
passphrase from the server instead, set `ADMIN_PASSPHRASE` (in `ecosystem.config.cjs` or the
environment) — it then overrides the panel. Forgot a changed passphrase and no superadmin access?
Delete `data/admin.json` and the default returns.

## Superadmin — plan & feature control (`/superadmin`)

A second, separate login for the site vendor (not the hotel), default passphrase `hotelsuper`
(`SUPERADMIN_PASSPHRASE` env var to force it). It is for selling features one at a time:

* **Enable/disable ~35 features individually** — every page (Suites, Amenities, Dining, Local
  Area, Gallery, Reviews, FAQ, Contact), home-page extras (slideshow, booking bar, promotions,
  overview stats, announcement bar, custom sections, maps, rating badge), booking mode, and admin
  tools (inquiries, media library, theme/custom CSS, navigation editor, layout editor,
  export/import, backups, datasets, passphrase change) and SEO Wizard steps individually.
* **Numeric plan limits** — max rooms, gallery items, promotions, FAQ items, custom sections,
  upload size (MB) — content over the limit stays in the hotel's admin but isn't published.
* **Per-feature price + note** — free-text, shown on the locked panel the hotel admin sees in
  place of a disabled feature/section, alongside a plan-wide upgrade message and contact info —
  so each feature can be pitched as its own micro-sale.
* **Enforcement is server-side** in both places: the public site (`features.apply(site)` runs
  before every page render and before the sitemap/SEO engine), and the hotel's own `/admin/api/*`
  (`features.requireFeature('id')` middleware returns 403 for a disabled tool). The admin UI
  (`public/admin/admin.js`) mirrors this so a disabled feature shows a locked panel instead of a
  broken form.
* Stored separately in `data/features.json` — never touched by the hotel's own export/import,
  reset, or backup-restore, so plan entitlements can't be bypassed from the hotel side.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8097` | Listen port (bound to 127.0.0.1) |
| `HOST` | `127.0.0.1` | Bind address |
| `SITE_URL` | – | Public URL for canonical/OG tags and the sitemap |
| `ADMIN_PASSPHRASE` | – | Overrides the hotel admin passphrase |
| `SUPERADMIN_PASSPHRASE` | – | Overrides the vendor superadmin passphrase |
| `SESSION_SECRET` | random, saved in `data/.secret` | Cookie-signing secret |
| `DATA_DIR` | `./data` | Where `site.json`, `inquiries.json`, `admin.json`, `features.json`, `backups/` live |

See `.env.example`. pm2 reads values from `ecosystem.config.cjs`.

## Deployment on the server (`server`, user `dad`)

```bash
cd /home/dad/wwwhotel/hoteldemosite
npm install --omit=dev
pm2 start ecosystem.config.cjs      # name: hoteldemo, port 8097
pm2 save                            # persists across reboots (pm2-dad.service)
```

Updating later:

```bash
cd /home/dad/wwwhotel/hoteldemosite && git pull && npm install --omit=dev && pm2 restart hoteldemo
```

### Cloudflare Tunnel + DNS

The server's `cloudflared` tunnel is remotely managed, so the hostname is added through the API.
`scripts/cloudflare-route.mjs` reads the credentials in `/home/dad/wwwhotel/.env`
(`CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_TUNNEL_ID`, `CF_ZONE_ID`, optional `CF_MASTER_TOKEN`):

```bash
node scripts/cloudflare-route.mjs --host hoteldemo1.signaturediversified.com --port 8097 --env /home/dad/wwwhotel/.env
# remove the route again:
node scripts/cloudflare-route.mjs --host hoteldemo1.signaturediversified.com --remove --env /home/dad/wwwhotel/.env
```

It adds the ingress rule `hoteldemo1… → http://127.0.0.1:8097` (keeping existing rules and the
404 catch-all) and creates/updates the proxied CNAME to `<tunnel-id>.cfargotunnel.com`. If
`CF_API_TOKEN` lacks a permission and `CF_MASTER_TOKEN` is set, it mints a scoped token
(Tunnel Write + DNS Write), appends it to the `.env` as `CF_API_TOKEN_TUNNEL_DNS`, and retries.

Useful checks:

```bash
bash scripts/health.sh            # or: npm run health
node scripts/seo-audit.mjs        # or: npm run audit
pm2 logs hoteldemo --lines 50
```

Day-to-day operation (deploy loop, backups, troubleshooting) is in `docs/OPERATIONS.md`; moving the
site onto the hotel's real domain is in `docs/GODADDY-CUTOVER.md`. The repo is also set up as an
aider project (`aider-hoteldemo` from the Desktop "Aider Projects" launcher; see `start_aider.sh`).

## Project structure

```
server.js                 Express app (static, routes, 404/500)
ecosystem.config.cjs      pm2 definition
src/
  store.js                JSON store: load/normalize/save, datasets, backups, inquiries, admin config
  auth.js                 passphrase check, signed cookie, rate limiting, CSRF header guard
  public.js               guest routes (/, /suites, /suites/:slug, /amenities, /dining, /area, /gallery, /reviews, /contact, robots, sitemap)
  admin.js                /admin pages + /admin/api/* JSON API + uploads
  superadmin.js           /superadmin pages + /superadmin/api/* JSON API (vendor plan/feature control)
  features.js             feature entitlements: FEATURES/LIMITS catalog, data/features.json store, apply(site), requireFeature(id)
  helpers.js              template helpers (money, stars, map URLs, fonts, theme colors)
  icons.js                inline SVG icon set
views/                    EJS templates (partials/ holds the reusable sections)
public/
  css/site.css            custom styles layered on Tailwind
  js/site.js              nav, slideshow, filters, lightbox, booking-bar dates
  admin/admin.css|js      the hotel admin panel + superadmin dashboard styles
  img/property/           property photos; img/favicon.svg, img/placeholder.svg
  uploads/                admin uploads (git-ignored)
  vendor/tailwind-*.js    Tailwind runtime
data/
  defaults.json           default content (Budget Suites)
  blank.json              empty template
  samples/upscale-demo.json  fictional sample dataset
  site.json               LIVE content (git-ignored, created on first run)
  inquiries.json, admin.json, features.json, .secret, backups/   runtime files (git-ignored)
scripts/
  cloudflare-route.mjs    tunnel + DNS helper
  deploy.sh               backup → pull → install → test → pm2 restart → health (human runs it)
  health.sh               read-only health check (pm2, local routes, public URL, SEO audit)
  backup.sh               full content backup / --restore (data/ + uploads)
  smoke.sh                throwaway server on a free port: every route + admin API (aider's /test)
  smoke-superadmin.sh     throwaway server: superadmin login, feature toggles, enforcement, passphrase resets, upload limit (aider's /test)
  seo-audit.mjs           CLI version of the admin Audit & Score tab
  cutover-check.mjs       DNS / https / canonical checks for a domain move
  site-url.mjs            show or set the canonical Site URL
  aider-test.sh           offline syntax/load/EJS checks (aider's /test)
docs/
  OPERATIONS.md           runbook: routine, deploy loop, troubleshooting, who-does-what
  GODADDY-CUTOVER.md      moving the site onto the hotel's real domain (GoDaddy → Cloudflare)
  SEO-ENGINE.md           how src/seo.js and the SEO Wizard fit together, how to extend them
  TASKS.md                recipes for common change requests
```

## Public routes

`/` · `/suites` · `/suites/<slug>` · `/amenities` · `/dining` · `/area` · `/gallery` · `/reviews`
(when enabled) · `/contact` (GET form, POST submission) · `/robots.txt` · `/sitemap.xml` · `/admin`
· `/superadmin` (vendor-only; also linked from the bottom of `/admin` when signed in as superadmin)

Any of the page routes above redirects to `/` if the site vendor has disabled that feature in
`/superadmin` — see the "Superadmin" section above.

## Notes

* Pages are server-rendered from `data/site.json`; the file is cached in memory and re-read only
  when saved from the admin, so page loads are cheap.
* Images can be any URL or an upload. The hero, room, gallery and attraction images in the sample
  datasets point at Unsplash; the Budget Suites dataset uses the photos in `public/img/property/`
  (cropped from phone screenshots — replace them with originals from the admin for best quality).
* The contact form has a honeypot field and per-IP throttling; submissions are stored locally in
  `data/inquiries.json` (no email is sent).
* Security headers, `trust proxy` for Cloudflare, and `secure` cookies over HTTPS are set in
  `server.js` / `src/auth.js`.
