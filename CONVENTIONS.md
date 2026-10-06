# CONVENTIONS — hoteldemo (hotel website + admin CMS)

Repo: `/home/dad/wwwhotel/hoteldemosite`. Everything you edit lives here. `README.md` (also in
chat, read-only) describes the stack, routes, admin sections and file layout — do not restate it.
`docs/OPERATIONS.md` (also read-only in chat) is the runbook: deploy loop, backups, troubleshooting,
and the table of what you may run yourself versus hand to the human.

On-demand references — ask the human to `/read` the one that matches the task before planning:
- `docs/GODADDY-CUTOVER.md` — domain, DNS, GoDaddy, nameservers, Cloudflare, "go live", redirects from an old site.
- `docs/SEO-ENGINE.md` — anything touching `src/seo.js`, the SEO Wizard, titles/descriptions, JSON-LD, sitemap, the audit.

## What this is

Node.js 22 · Express 4 · EJS server-rendered pages · vendored Tailwind runtime + `public/css/site.css`
· all content in `data/site.json`, edited from `/admin` · runs under pm2 as `hoteldemo` on
`127.0.0.1:8097` behind a Cloudflare tunnel (`https://hoteldemo1.signaturediversified.com`).
No database, no build step, no bundler. Dependencies: express, ejs, multer, compression, cookie-parser.

## Hard rules

1. Only create or edit files inside this repo. Never write to `/etc`, `/www`, `~/.cloudflared`,
   `/home/dad/wwwhotel/.env`, or any absolute path outside the repo.
2. Never read, print, or edit `data/site.json`, `data/inquiries.json`, `data/admin.json`,
   `data/.secret`, `data/backups/`, `public/uploads/`, or any `.env`. Live content is edited in
   `/admin`; defaults are edited in `data/defaults.json`, `data/blank.json`, `data/samples/*.json`.
3. Never run `pm2`, `sudo`, `systemctl`, `npm install`, `git push`, or `rm -rf`. When a change
   needs one of those (new dependency, restart), finish the edit and then tell the human the exact
   command — normally `bash scripts/deploy.sh --local` (backs up, tests, restarts, health-checks).
   Read-only scripts you MAY run with `/run`: `bash scripts/aider-test.sh`, `bash scripts/health.sh --quick`,
   `node scripts/seo-audit.mjs`, `node scripts/cutover-check.mjs <domain>`. Everything else in
   `scripts/` (deploy, backup, site-url, cloudflare-route) changes live state: human only.
4. No new npm dependencies without asking first. Prefer the Node standard library and the five
   packages already in `package.json`.
5. No placeholders (`path/to/file`, `TODO: fill in`, `<YOUR_...>`) in files you write. Use the real
   value or ask.
6. Small, targeted edits. Never rewrite a whole file for a one-line change. Preserve existing
   indentation (2 spaces), single quotes, semicolons, and existing comments.
7. Files on disk never contain markdown fences (```). Fences are for chat only.

## Server-side JavaScript (`server.js`, `src/*.js`)

- CommonJS (`require` / `module.exports`), `const` by default, `async/await` for anything async.
- Every route handler validates its input before touching the store; respond with JSON
  `{ error: '...' }` and a 4xx status on bad input — never throw to the client.
- Content flows one way: `src/store.js` loads/normalizes/saves `site.json`; routes in
  `src/public.js` / `src/admin.js` read via the store and pass data to EJS. Do not read JSON files
  directly from routes or templates.
- When adding a field to the site schema: update `normalize(site)` in `src/store.js`, add a default
  in `data/defaults.json` AND `data/blank.json`, add the admin editor entry in
  `public/admin/admin.js`, then render it in the view. List those four places in your plan.
- Keep `src/auth.js` behavior intact: passphrase check, HMAC cookie, rate limit, CSRF header guard.
  Every `/admin` page and `/admin/api/*` route (except login) must stay behind `auth.requireAdmin`.
- SEO lives in `src/seo.js`. Add to it rather than scattering `<meta>` logic in views. Its constants
  are mirrored in `public/admin/admin.js` (`SEO_*`) — change both in the same commit (`docs/SEO-ENGINE.md`).
- Never invent facts for the site: no made-up ratings, review counts, statistics, awards, distances
  or amenities in defaults, suggestions, schema or copy. Use what `site.json` already says, or ask.

## Views (`views/**/*.ejs`)

- Reusable blocks are partials in `views/partials/`; home-page sections are
  `views/partials/section-*.ejs`, registered in the `renderers` map at the top of `views/home.ejs`
  and ordered by `site.layout.homeOrder`. New home section = new `section-<name>.ejs` partial +
  one entry in `renderers` + the matching option in the admin "Home Page Layout" editor, not
  inline HTML in `home.ejs`.
- Escape all user content with `<%= %>`. Use `<%- %>` ONLY for values the code already sanitized
  or that are explicitly raw HTML (custom sections, custom `<head>`).
- Every element must be responsive: Tailwind utility classes, mobile-first (`sm:`, `md:`, `lg:`),
  flex/grid, relative units. No inline `style=` except for admin-controlled colors/images that
  come from `site.theme`.
- Only Tailwind classes that exist in Tailwind 3.4 core. No plugins, no CDN scripts, no
  framework JS (React/Vue/Alpine/jQuery).

## Browser JavaScript (`public/js/site.js`, `public/admin/admin.js`)

- Vanilla ES2020, no modules/bundler, no external libraries. Feature-detect, never break the page
  if an element is missing (`if (!el) return;`).
- `admin.js` is schema-driven: add fields to the schema objects rather than hand-writing HTML.
- Talk to the server only via `/admin/api/*` with `fetch`, always sending the CSRF header the
  existing helper already adds.

## CSS (`public/css/site.css`)

- Custom CSS only for what Tailwind can't express. Use the CSS custom properties that
  `views/partials/head.ejs` sets from `site.theme` (`--brand`, `--brand-dark`, `--brand-light`,
  `--accent`, `--accent-dark`; RGB triplets, so `rgb(var(--brand) / 0.5)`) or the Tailwind colors
  `brand` / `accent` mapped to them — never hard-coded hex colors.

## Verification

- After JS edits, `/lint` runs `node --check` automatically. Before you say a change is done, ask
  the human to run `/test` (runs `scripts/aider-test.sh`: syntax check, module load in a temp
  DATA_DIR, every EJS view compiles). `/test` never touches live data or pm2.
- The human then runs: `pm2 restart hoteldemo && pm2 logs hoteldemo --lines 30` and checks
  `curl -I http://127.0.0.1:8097/`. Never run those yourself.

## When planning (architect mode)

0. Read-only first: if the task is "is it working / why is it broken / how is SEO", run the matching
   read-only script (`health.sh --quick`, `seo-audit.mjs`, `cutover-check.mjs`) and reason from its
   output instead of guessing.
1. Name every file you will touch and why, before any edit.
2. Flag separately anything that needs a manual step: `pm2 restart`, `npm install`, a Cloudflare
   change (`node scripts/cloudflare-route.mjs ...`), or deleting runtime data.
3. If the request is ambiguous about where content comes from (hard-coded vs. admin-editable),
   default to admin-editable through `site.json` and say so.
