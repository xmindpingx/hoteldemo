# GODADDY CUTOVER — moving the site onto the hotel's real domain

Load this when the task mentions the domain, DNS, GoDaddy, nameservers, Cloudflare, "go live" or
"cutover". Replace `<domain>` below with the real domain registered at GoDaddy (not known at the time
of writing — ask the human; never guess it). Nothing here is run by aider: every command is for the
human, and aider's job is to prepare, verify (`scripts/cutover-check.mjs` is read-only) and explain.

## What a cutover actually changes

Only three things move. Everything else about the site stays as it is.

1. **DNS** — `<domain>` (and `www.<domain>`) must resolve to wherever the site is served.
2. **The site's own idea of its URL** — Admin → SEO Wizard → Basics → *Site URL* (CLI:
   `node scripts/site-url.mjs`). Canonical links, `og:url`, `sitemap.xml`, `robots.txt`'s Sitemap
   line and every JSON-LD `@id` are built from it, so this must change the moment DNS does.
3. **Search engines** — tell Google/Bing about the new address (Search Console / Webmaster Tools)
   and point the Google Business Profile at it.

## Facts this plan relies on (verified Oct 2026)

- Cloudflare: *"The cfargotunnel.com subdomain only proxies traffic for DNS records in the same
  Cloudflare account."* (developers.cloudflare.com, Cloudflare Tunnel → DNS). So the tunnel that
  serves this site today **cannot serve a hostname whose DNS stays at GoDaddy**. The domain's DNS has
  to be in the Cloudflare account — which is done by changing the domain's nameservers at GoDaddy
  (the registration itself stays at GoDaddy).
- GoDaddy's documented path to change nameservers: Domain Portfolio → select the domain →
  **DNS** → **Nameservers** → *"I'll use my own nameservers"* → enter them → **Save** → **Continue**
  (identity verification may be asked). GoDaddy's own warnings: changes usually apply within an hour
  but can take up to 48 hours; changing nameservers "may break existing connections to your website
  or email" — check email (MX) records before and after.
- GoDaddy's documented path to add a DNS record (only needed for path B): Domain Portfolio →
  select the domain → **Domain Settings** → **DNS** tab → **Add New Record** → Type **A**, Name
  `@`, Value = server IP, TTL (default 1 hour) → **Save**.
- Menu wording at GoDaddy changes over time; if it looks different, GoDaddy's help center is the
  source of truth — do not improvise.
- Domain **forwarding** and DNS records are two different mechanisms. Forwarding redirects visitors
  at the registrar; A/CNAME records point DNS at a server. Never leave forwarding on for a hostname
  that has an A/CNAME record meant to reach this site.

## Path A (recommended): keep hosting on this server, move the domain's DNS to Cloudflare

Why: zero change to how the app runs (same server, same pm2 process, same tunnel, free TLS), and the
existing `scripts/cloudflare-route.mjs` already knows how to publish a hostname.

**Before touching GoDaddy**

1. `bash scripts/backup.sh` and `bash scripts/health.sh` — start from a known-good state.
2. Decide the canonical form: `https://<domain>` or `https://www.<domain>`. Pick one; the other
   will redirect to it. (Bare domain is the simpler choice for a hotel.)
3. In the Cloudflare dashboard (same account that owns the tunnel): **Add a site** → `<domain>` →
   Free plan. Cloudflare shows two nameservers (`*.ns.cloudflare.com`) and, if GoDaddy's DNS is
   readable, imports the existing records. **Check email records** (MX/TXT) survived the import if the
   hotel uses email on this domain.
4. Note the new zone's **Zone ID** (Cloudflare → `<domain>` → Overview, right column).
5. Create the credentials file for the new zone, copying the existing one and changing only the
   zone: `cp /home/dad/wwwhotel/.env /home/dad/wwwhotel/.env.<domain>` then edit `CF_ZONE_ID=` in
   the copy. Account, tunnel and token stay the same. (The token must have DNS edit rights on the
   new zone; if the route script reports a permission error and `CF_MASTER_TOKEN` is set, it mints a
   scoped token itself — see README.)
6. Pre-create the tunnel routes so the hostname works the instant DNS flips:
   `node scripts/cloudflare-route.mjs --host <domain> --port 8097 --env /home/dad/wwwhotel/.env.<domain>`
   `node scripts/cloudflare-route.mjs --host www.<domain> --port 8097 --env /home/dad/wwwhotel/.env.<domain>`
   In Cloudflare → `<domain>` → SSL/TLS: mode **Full**; Edge Certificates: **Always Use HTTPS** on.

**The switch (at GoDaddy)**

7. Domain Portfolio → `<domain>` → DNS → Nameservers → *I'll use my own nameservers* → paste the two
   Cloudflare nameservers → Save → Continue. Turn **off** any Domain Forwarding on the domain.
8. Wait. Check with `node scripts/cutover-check.mjs <domain>` every so often: the first line must
   show `*.ns.cloudflare.com`, then the `https://<domain>/ loads` check turns PASS.

**Right after DNS resolves here**

9. `node scripts/site-url.mjs https://<domain>` (or the www form chosen in step 2), then update
   `SITE_URL` in `ecosystem.config.cjs` to the same value (that is the fallback the env provides),
   then `pm2 restart hoteldemo --update-env`.
10. Admin → SEO Wizard → Hosting & Redirects: turn on **Enforce canonical host** (sends
    `www.<domain>` and the old `hoteldemo1.signaturediversified.com` to the canonical host with a 301).
    Leave **Force HTTPS** off while Cloudflare's *Always Use HTTPS* is on — Cloudflare already does it;
    both on is harmless but redundant.
11. `node scripts/cutover-check.mjs <domain>` → `All checks passed.` and
    `node scripts/seo-audit.mjs` → no FAIL. `bash scripts/health.sh`.
12. Keep the `hoteldemo1…` route for a while (it now redirects); remove it later with
    `node scripts/cloudflare-route.mjs --host hoteldemo1.signaturediversified.com --remove --env /home/dad/wwwhotel/.env`.

## Path B: hosting the app somewhere else (a GoDaddy VPS or any other Node host)

Only if the decision is to stop serving from this server. The app needs: Node 18+, `pm2` (or any
process manager), a reverse proxy with TLS in front of `127.0.0.1:8097` (nginx + Let's Encrypt, or
the host's own proxy), and persistent disk for `data/` and `public/uploads/`. Whether a given
GoDaddy hosting product provides that could not be verified here — a long-running Node process needs
a VPS-style product, not a basic shared/website-builder plan; confirm with GoDaddy before buying.

1. On the new host: `git clone https://github.com/xmindpingx/hoteldemo.git`, `npm install --omit=dev`,
   copy the latest `hoteldemo-*.tgz` from `/home/dad/wwwhotel/backups/` and
   `bash scripts/backup.sh --restore <file>` (brings `data/` and uploads), set `SITE_URL` and the
   port in `ecosystem.config.cjs`, `pm2 start ecosystem.config.cjs && pm2 save`, put TLS in front.
2. At GoDaddy: Domain Settings → DNS → Add New Record → **A**, Name `@`, Value = the new host's IP;
   and a **CNAME**, Name `www`, Value `@` (or the host's hostname). Remove any Domain Forwarding.
3. Then steps 9–11 from path A on the new host (`site-url.mjs`, restart, `cutover-check.mjs`).

## After either path: search engines and listings

- Google Search Console: add `<domain>` as a new property (a *Domain* property covers www and bare),
  verify (paste the HTML-tag code into SEO Wizard → Search Engines → Google verification, deploy,
  then click Verify), submit `https://<domain>/sitemap.xml`. Same at Bing Webmaster Tools.
- If the hotel's **old website** lived on this same domain, keep its old URLs alive: list each old
  path → new path in SEO Wizard → Hosting & Redirects → *Redirect rules* (301). Use Search Console's
  coverage report after a week to find 404s that still get traffic and add rules for them.
- If the old site was on a **different** domain that the hotel still controls, point that domain at
  this site the same way and add its redirect rules; Search Console's *Change of Address* tool
  applies in that case (old domain → new domain), not when the domain stays the same.
- Update the website link on the Google Business Profile, and on every directory that lists the
  hotel (same name/address/phone everywhere — Local SEO tab).
- One week later: `node scripts/seo-audit.mjs`, Search Console → Pages, and the Audit tab in the
  wizard.

## Rollback

- DNS not propagating / site unreachable for more than a few hours: at GoDaddy set the nameservers
  back to GoDaddy's defaults (DNS → Nameservers → *GoDaddy nameservers*); the old site returns.
- App pointing at the wrong URL: `node scripts/site-url.mjs <previous url>`, `pm2 restart hoteldemo`.
- Content damaged: `bash scripts/backup.sh --restore <file>`, `pm2 restart hoteldemo`.
- The demo hostname `hoteldemo1.signaturediversified.com` keeps working throughout path A, so there is
  always a known-good address to test against.
