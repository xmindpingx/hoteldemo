# TASKS — recipes for the requests that come up on this site

Each recipe: what the human usually says → is it a code change at all? → files → steps → how to
verify. Follow the matching recipe before planning anything else. "Admin" means `/admin` in the
browser; the human does those, aider does not edit `data/site.json`.

## Not a code change (answer: "do it in the admin")

| Request | Where in /admin |
|---|---|
| change phone, email, address, check-in time, hotel name, tagline | General & Contact Info |
| change prices, add/remove a suite, photos of a suite | Suites & Rooms |
| change colors, fonts, button shape | Theme & Fonts |
| hide a page/section, reorder the home page | the section's "Show" toggle; Home Page Layout |
| wipe the demo data / bring it back | Data, Reset & Security |
| change a page title / meta description / social image | SEO Wizard → Pages & Previews |
| add a Google Analytics / Tag Manager / Meta Pixel ID | SEO Wizard → Analytics |
| add a redirect from an old URL | SEO Wizard → Hosting & Redirects |
| verify the site in Google Search Console | SEO Wizard → Search Engines (paste the HTML-tag code) |
| change the admin passphrase | Data, Reset & Security |

If the admin cannot do it yet, the fix is to **make it admin-editable** (next section), not to
hard-code the value.

## Add an admin-editable field to an existing section (e.g. "a second phone number")

1. `data/blank.json` + `data/defaults.json`: add the key with an empty / real default (both files).
2. `src/store.js` `normalize()`: only if the field needs coercion or is a list (`LIST_PATHS`).
3. `public/admin/admin.js`: add `F.text('phone2', 'Second phone')` to that section's `fields` in `SECTIONS`.
4. The view: render it with `<%= site.general.phone2 %>` guarded by `<% if (…) { %>`.
5. `/test`. Then the human deploys and fills the value in the admin.

## Add a new public page (e.g. `/events`)

1. `src/public.js`: route with `sectionGuard('events')` (if it can be hidden) and `setMeta(res, { page: 'events', title, description })`.
2. `views/events.ejs` built like `views/amenities.ejs` (include head/nav/footer partials; one `<h1>`).
3. `data/blank.json` + `defaults.json`: `events: { enabled, heading, intro, items: [] }` and `seo.pages.events`.
4. `src/seo.js`: add `events` to `PAGE_KEYS`, `PAGE_PATHS`, `PAGE_LABELS`, `PAGE_SECTION`.
5. `public/admin/admin.js`: new `SECTIONS` entry; add `'events'` to `SEO_PAGE_KEYS` / `SEO_PAGE_LABELS`.
6. Navigation: the human adds the menu item in Admin → Navigation (or add it to `defaults.json` nav).
7. `/test` (smoke prints the new route) → human deploys → `node scripts/seo-audit.mjs` shows the page.

## Add a home-page section (e.g. "Nearby employers")

1. `views/partials/section-employers.ejs` modeled on an existing `section-*.ejs`.
2. `views/home.ejs`: one entry in the `renderers` map.
3. `data/*.json`: the section object + add `'employers'` to `layout.homeOrder`; `HOME_SECTION_KEYS` in admin.js.
4. Admin: `SECTIONS` entry with `enabledToggle()`, heading, intro, list.
5. `/test`.

## Add an amenity icon

`src/icons.js` (the SVG path, same 24×24 stroke style, add to `AMENITY_ICON_NAMES`) → it appears in
every admin icon picker automatically (`/admin/api/meta` serves the list). Keep the `UI` icon set in
`admin.js` for admin-only chrome; amenity icons do not go there.

## Change what the SEO audit checks / add a check

`docs/SEO-ENGINE.md` → "How to… add an audit check". Then `/test` and `node scripts/seo-audit.mjs`.

## Prepare for / perform the domain cutover

Human must `/read docs/GODADDY-CUTOVER.md` first. aider's part: make sure `node scripts/cutover-check.mjs <domain>`
passes except for DNS/https items that the human has not switched yet, and prepare redirect rules for
the old site's URLs in `defaults.json` only if the human asks for them to be defaults — otherwise they
go in via the admin.

## "The site is down / slow / wrong"

1. `/run bash scripts/health.sh --quick` — read which line is FAIL.
2. Map it with the Troubleshooting table in `docs/OPERATIONS.md`.
3. If a code fix is needed: fix, `/test`, tell the human `bash scripts/deploy.sh --local`.
4. If no code fix is needed (pm2 down, DNS, tunnel, disk): give the human the exact command from the table.

## "Make it faster"

Pages are server-rendered from an in-memory object and the Tailwind runtime is vendored, so the usual
wins are: image sizes (`public/img/property/`, uploads — resize before upload; `loading="lazy"` on
below-the-fold `<img>`), `compression` is already on, static assets get a 1 h cache in production.
Do not add a build step or a bundler.

## "Add a dependency"

Ask first (hard rule 4). If approved: `package.json` edit only — the human runs `npm install` via
`bash scripts/deploy.sh --local` (it installs when `package.json` changed).

## Writing copy (descriptions, FAQ answers, amenity text)

Only facts already present in `data/defaults.json`, the admin, or given by the human. No invented
distances, ratings, review counts, "award-winning", "#1", or amenities the property does not list.
When a sentence needs a fact nobody supplied, leave a clearly marked gap and ask — never fill it.
