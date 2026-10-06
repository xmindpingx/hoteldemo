# OPERATIONS — running the hotel site day to day

Read this together with `CONVENTIONS.md` (rules) and `README.md` (stack/layout). This file is the
runbook: how the site runs, what to check, what to run when something is wrong, and which steps
aider does itself versus hands to the human. Domain moves live in `docs/GODADDY-CUTOVER.md`; the
SEO code is explained in `docs/SEO-ENGINE.md`.

## How it runs

- One Node process, `pm2` name `hoteldemo`, listening on `127.0.0.1:8097` (`ecosystem.config.cjs`).
- A Cloudflare Tunnel on this server forwards the public hostname to that port. Public URL today:
  `https://hoteldemo1.signaturediversified.com`. The tunnel route is managed with
  `node scripts/cloudflare-route.mjs` (credentials in `/home/dad/wwwhotel/.env`, never in this repo).
- All content is `data/site.json`, edited only through `/admin` (passphrase default `hoteldemo`).
  The server caches it in memory and re-reads it when the admin saves — so a file restored or edited
  by any other means needs `pm2 restart hoteldemo` to show up.
- The public URL the site believes in (canonical links, og:url, sitemap, JSON-LD) comes from, in order:
  Admin → SEO Wizard → Basics → **Site URL**, then the `SITE_URL` env in `ecosystem.config.cjs`, then
  the request's Host header. `node scripts/site-url.mjs` shows which one is in effect.

## Where things live

| What | Path | In git? |
|---|---|---|
| Code, views, admin UI, default content | repo root, `src/`, `views/`, `public/`, `data/defaults.json` | yes |
| Live content | `data/site.json` | no — back it up |
| Contact-form inquiries, passphrase hash, cookie secret | `data/inquiries.json`, `data/admin.json`, `data/.secret` | no |
| Admin's automatic save history (last 30) | `data/backups/site-*.json` | no |
| Uploaded photos | `public/uploads/` | no — back it up |
| Full backups made by `scripts/backup.sh` | `/home/dad/wwwhotel/backups/hoteldemo-*.tgz` (last 14) | — |
| Process logs | `pm2 logs hoteldemo` → `~/.pm2/logs/hoteldemo-*.log` | — |
| Tunnel / DNS credentials | `/home/dad/wwwhotel/.env` | never |

## Routine

| When | Command | Good result |
|---|---|---|
| Any time / after a deploy | `bash scripts/health.sh` | ends with `HEALTHY` |
| Before any risky change | `bash scripts/backup.sh` | prints the `.tgz` path |
| Weekly, and after content edits | `node scripts/seo-audit.mjs` | score ≥ 80, no `FAIL` lines |
| After a domain/DNS change | `node scripts/cutover-check.mjs <domain>` | `All checks passed.` |
| To ship code | `bash scripts/deploy.sh` (from GitHub) or `bash scripts/deploy.sh --local` (tree as edited by aider) | ends with `HEALTHY` |

Suggested cron (human installs with `crontab -e`):

```
5 3 * * *   /bin/bash /home/dad/wwwhotel/hoteldemosite/scripts/backup.sh >> /home/dad/logs/hoteldemo-backup.log 2>&1
*/30 * * * * /bin/bash /home/dad/wwwhotel/hoteldemosite/scripts/health.sh --quick > /tmp/hoteldemo-health.txt 2>&1 || cat /tmp/hoteldemo-health.txt
```

## Shipping a change (the normal loop)

1. aider edits files in the repo (auto-commits each change).
2. aider runs `/test` (= `scripts/aider-test.sh`: syntax, module load, EJS compile). Fix until it passes.
3. aider tells the human: **run `bash scripts/deploy.sh --local`**. That script backs up, installs
   deps if `package.json` changed, re-runs the tests, restarts pm2, and runs the health check — and
   stops at the first failure, so a broken edit never replaces the running site.
4. If the change touched SEO fields or templates: `node scripts/seo-audit.mjs`.
5. `git push origin main` when the human wants GitHub to have it (the repo is `xmindpingx/hoteldemo`).

## Content operations (no code)

- Everything visible is edited in `/admin`. Sidebar sections map 1:1 to pages/blocks (see README).
- Demo/mock data: **Data, Reset & Security → Wipe everything (blank site)** removes it;
  **Restore default content** brings the Budget Suites dataset back. Single sections can be swapped
  from any dataset on the same page.
- Undo a bad save: **Data, Reset & Security → Backups → Restore** (the last 30 saves).
- Full restore from a `.tgz`: `bash scripts/backup.sh --restore <file>` then `pm2 restart hoteldemo`.
- Change the admin passphrase in **Data, Reset & Security**. Forgotten: delete `data/admin.json`
  (default `hoteldemo` returns) — or set `ADMIN_PASSPHRASE` in `ecosystem.config.cjs` to pin it.
- SEO: **SEO Wizard** tab — Basics (Site URL, category, title pattern), Pages (per-page titles,
  live preview), Structured Data, Local SEO, Search Engines (verification, sitemap), Analytics,
  Hosting & Redirects, Audit & Score. The audit is the same one `scripts/seo-audit.mjs` runs.

## Troubleshooting

| Symptom | Look | Fix |
|---|---|---|
| Public URL shows a Cloudflare 502/530 page | `pm2 list`, `pm2 logs hoteldemo --lines 50` | process down or crashed: `pm2 restart hoteldemo`; if it loops, read the stack trace, fix, `bash scripts/deploy.sh --local` |
| Public URL times out / wrong site, local `curl -I http://127.0.0.1:8097/` is 200 | `node scripts/cutover-check.mjs <host>` | tunnel route or DNS missing → `node scripts/cloudflare-route.mjs --host <host> --port 8097 --env /home/dad/wwwhotel/.env` |
| `EADDRINUSE 8097` in logs | `ss -ltnp \| grep 8097` | a second copy is running (someone ran `node server.js` by hand) — kill it, keep pm2's |
| Admin says "Saved" but the site did not change | hard-refresh; `pm2 logs` for write errors | `data/` not writable (`ls -la data`), or disk full (`df -h`) |
| Changes to code do not appear | `pm2 describe hoteldemo` uptime | code changes need `pm2 restart hoteldemo` (deploy.sh does it); views are cached in production |
| Images broken after a restore | `ls public/uploads` | uploads were not in the restore; `bash scripts/backup.sh --restore` includes them, the admin's own backups do not |
| SEO audit score dropped | `node scripts/seo-audit.mjs` | each `FAIL`/`WARN` names the wizard tab and field to fix |
| Sitemap/canonical show the wrong domain | `node scripts/site-url.mjs` | set the right one: `node scripts/site-url.mjs https://<domain>` then `pm2 restart hoteldemo` |
| Cannot log in to /admin, "Too many attempts" | — | login is rate-limited per IP for 15 minutes; wait, or restart the process to clear it |
| Contact form submissions not arriving | `/admin` → Inquiries | nothing is emailed by design; submissions are stored in `data/inquiries.json` and shown there |

## Security basics

- Keep `/admin` behind the passphrase; the footer "Site Admin" link can be hidden in **Footer**.
- `robots.txt` already disallows `/admin`; `/admin/api/*` requires the login cookie **and** the
  `X-Requested-With: fetch` header, so browsers cannot be tricked into calling it from another site.
- Never commit `data/site.json`, `data/admin.json`, `data/.secret`, `.env`, or anything from
  `/home/dad/wwwhotel/.env`. `.gitignore` and `.aiderignore` already exclude them — keep it that way.
- Dependencies: `npm audit` occasionally; upgrade with `npm update` only after `/test` and a deploy
  on a quiet hour. There are only five runtime dependencies on purpose.

## Who does what

| aider may do on its own | aider must hand to the human (say the exact command) |
|---|---|
| edit code/views/admin UI/default data in the repo | `bash scripts/deploy.sh …`, `pm2 …`, `npm install`, `git push` |
| `/run bash scripts/aider-test.sh` (= `/test`) | `bash scripts/backup.sh` / `--restore` |
| `/run node scripts/seo-audit.mjs` (read-only) | `node scripts/site-url.mjs <url>` (writes live content) |
| `/run bash scripts/health.sh --quick` (read-only) | `node scripts/cloudflare-route.mjs …` (changes DNS/tunnel) |
| `/run node scripts/cutover-check.mjs <domain>` (read-only) | anything in `/admin`, GoDaddy, Cloudflare, Search Console |
