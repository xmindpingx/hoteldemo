# SEO ENGINE — how `src/seo.js` and the admin SEO Wizard fit together

Load this before changing anything SEO-related. One rule above all: **suggestions and audit text
must come from the site's own data or from measured facts — never invent statistics, rankings,
ratings or claims.** The audit fetches real pages and counts; `suggestions()` only recombines fields
that already exist in `site.json`.

## Data model (`site.seo`, defaults in `data/blank.json` + `data/defaults.json`)

| Key | Used for |
|---|---|
| `siteUrl` | base of every absolute URL; normalized by `store.normalize()` (https:// added, trailing / removed) |
| `title`, `description`, `ogImage`, `favicon`, `customHeadHtml` | site-wide fallbacks / raw head HTML |
| `category`, `keyAmenity`, `homeTitleTemplate`, `pageTitleTemplate` | title templating (`{hotel} {city} {state} {category} {amenity} {brand} {page} {phone} …`) |
| `keywords[]`, `metaKeywords` | audit keyword check; optional `<meta name=keywords>` |
| `pages.<key>` = `{title, description, ogImage, noindex}` | per-page overrides; keys = `PAGE_KEYS` |
| `social`, `schema`, `local`, `robots`, `sitemap`, `verification`, `analytics`, `hosting` | one wizard step each |
| `redirects[]` = `{from, to, type}` | exact-path 301/302 rules, normalized by `store.normalizePath()` |

## `src/seo.js` map

| Function | Called from | Does |
|---|---|---|
| `pageMeta(site, ctx)` | `src/public.js setMeta()`, 404 handler, admin preview | resolves title/description/canonical/robots/OG/Twitter/geo for one page. Precedence: page override → room fields → route `ctx.description` (section intro) → `seo.description` → tagline |
| `renderHead(meta)` | `views/partials/head.ejs` | the `<title>`/`<meta>`/`<link>` block |
| `jsonLd(site, ctx)` / `renderJsonLd` | head partial, admin preview | Hotel/Motel (+ `HotelRoom` offers), `WebSite`, `FAQPage`, `BreadcrumbList`; toggles under `seo.schema` |
| `renderAnalyticsHead / renderBodyStart / renderBodyEnd` | head + footer partials | GA4 / GTM / Meta Pixel / Clarity snippets — IDs are regex-validated; an invalid ID outputs nothing |
| `robotsTxt`, `sitemapEntries`, `sitemapXml` | `/robots.txt`, `/sitemap.xml`, audit | respects disabled sections, `pages.<key>.noindex`, `sitemap.includeRooms` |
| `parseRobots`, `robotsBlocksAll`, `robotsBlockedAgents` | audit, `scripts/cutover-check.mjs` | robots.txt parsed per user-agent group. Needed because **Cloudflare prepends its managed robots.txt at the edge** (Content-Signal line + `Disallow: /` for ~30 AI/data crawlers such as GPTBot, ClaudeBot, Bytespider). Those blocks are per-crawler; only a `User-agent: *` + `Disallow: /` counts as "site blocked". Googlebot/Bingbot are not in Cloudflare's list, so search indexing is unaffected. The app never emits those lines — do not try to "fix" them in `robotsTxt()`; they are a Cloudflare zone setting |
| `middleware(getSite)` | `server.js` (before static) | redirect rules, trailing slash, Force HTTPS, canonical host. Never touches `/admin`, localhost or requests carrying `x-seo-audit: 1` |
| `suggestions(site)` | admin preview | title patterns rendered with the site's vars; per-page descriptions built from name/city/amenities/rooms/FAQ |
| `audit(site, {port, base})` | `/admin/api/seo/audit`, `scripts/seo-audit.mjs` | settings checks + live fetch of every sitemap URL; weighted 0–100 score |

Constants: `TITLE_MAX = 60`, `DESC_MAX = 160`, `PAGE_KEYS/PAGE_PATHS/PAGE_LABELS`, `SCHEMA_TYPES`,
`HOME_TITLE_TEMPLATES` / `PAGE_TITLE_TEMPLATES` (annotated with the real competitor pattern each echoes).

**Mirrors in `public/admin/admin.js`** (search `SEO_`): `SEO_PAGE_KEYS`, `SEO_PAGE_LABELS`,
`SEO_SCHEMA_TYPES`, `SEO_TITLE_MAX`, `SEO_DESC_MAX`, the four analytics regexes, `SEO_HOME_TEMPLATES`,
`SEO_PAGE_TEMPLATES`, `seoTemplateVars()`, `seoRenderTemplate()`. They must stay byte-identical to the
server versions — change both sides in the same commit. The authoritative preview always comes from
the server (`POST /admin/api/seo/preview` with the unsaved editor state), the mirrors only drive the
pattern-picker buttons and the ID format hints.

## Admin wizard (`public/admin/admin.js`, section `custom: 'seo'`)

`renderSeo(container)` draws the step tabs and calls the step's `render(body)` from `SEO_STEPS`.
Steps reuse the schema field builders (`renderField(F.text(...), ['seo', ...])`) so every ordinary
input is bound to `state.site` by the existing delegated `onEdit`. Hand-built parts: SERP preview
(`renderSeoPages`, debounced live refresh), JSON-LD / robots previews (manual refresh buttons),
score ring + checklist (`renderSeoAudit`). `seoJump(stepId)` switches steps; audit checks carry
`step`/`field` so their *Fix* button lands on the right tab.

## How to…

- **Add an audit check**: in `audit()`, `add('<group>', { id, weight, status: 'pass'|'warn'|'fail'|'info', label, detail, step, field })`.
  `info` is not scored. Groups: `setup`, `pages`, `content`, `local`. The wizard and the CLI pick it
  up with no UI change.
- **Add a public page**: route in `src/public.js` with `setMeta(res, {page, title, description})`;
  add the key to `PAGE_KEYS`, `PAGE_PATHS`, `PAGE_LABELS` (+ `PAGE_SECTION` if a section toggle hides
  it); add `pages.<key>` to `blank.json` and `defaults.json`; add the key to `SEO_PAGE_KEYS` /
  `SEO_PAGE_LABELS` in admin.js. `store.normalize()` creates the override slot from `blank.json`.
- **Add a schema field**: `seo.schema.<field>` in both data files → `lodgingSchema()` →
  `renderSeoSchema()` field. Use `compact()`: `undefined`/`''`/`[]` are dropped automatically.
- **Add a title template**: append `{ tpl, note }` to the server array **and** the admin mirror.
  Say which real site the pattern was observed on in `note`, or describe it neutrally.
- **Add an analytics/tag vendor**: regex + snippet in `renderAnalyticsHead()`, field + hint in
  `renderSeoAnalytics()`, key in both data files.
- **Change the audit threshold** for a deploy gate: `node scripts/seo-audit.mjs --fail-under 80`.

## Verifying SEO changes

1. `/test` (syntax, module load, EJS).
2. `node scripts/seo-audit.mjs` against the running server (human restarts pm2 first after a deploy).
3. Admin → SEO Wizard → Pages: the SERP preview must show the intended title/description for every
   page key, within the character counters.
4. External: Google Rich Results Test on the public URL for JSON-LD; `curl -s <url> | grep -i '<meta'`.
