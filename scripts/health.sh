#!/bin/bash
# Health check for the running hotel site. READ-ONLY: curls the local server, asks pm2 for status,
# runs the SEO audit. Never restarts anything, never writes to data/.
#
#   bash scripts/health.sh              # local checks + public URL from SITE_URL / Site URL setting
#   bash scripts/health.sh --quick      # skip the SEO audit (fast)
#   PORT=8097 bash scripts/health.sh
#
# Exit code 0 = healthy, 1 = something failed (for cron: mail the output when it exits 1).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
PORT="${PORT:-$(node -e "const e=require('./scripts/lib.cjs').loadPm2Env();console.log(e.PORT||8097)")}"
QUICK=0; [ "${1:-}" = "--quick" ] && QUICK=1
fail=0
ok()   { printf '  PASS %s\n' "$*"; }
bad()  { printf '  FAIL %s\n' "$*"; fail=1; }
warn() { printf '  WARN %s\n' "$*"; }

echo "== process"
if command -v pm2 >/dev/null 2>&1; then
  st=$(pm2 jlist 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const a=JSON.parse(d).find(p=>p.name==='hoteldemo');console.log(a?a.pm2_env.status+' restarts='+a.pm2_env.restart_time+' mem='+Math.round(a.monit.memory/1048576)+'MB':'missing')}catch(e){console.log('unknown')}})")
  case "$st" in online*) ok "pm2 hoteldemo $st" ;; missing) bad "pm2 has no process named hoteldemo (pm2 start ecosystem.config.cjs)" ;; *) bad "pm2 hoteldemo: $st (pm2 logs hoteldemo --lines 50)" ;; esac
else
  warn "pm2 not on PATH — skipping process check"
fi

echo "== local server 127.0.0.1:$PORT"
for p in / /suites /amenities /contact /robots.txt /sitemap.xml /admin/login /superadmin/login; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -H 'x-seo-audit: 1' "http://127.0.0.1:$PORT$p")
  if [ "$code" = "200" ]; then ok "$p → 200"
  elif [ "$code" = "302" ] && [[ "$p" =~ ^/(suites|amenities|contact)$ ]]; then
    # a content page that is switched off (hotel admin or /superadmin plan) redirects home by design
    loc=$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 8 "http://127.0.0.1:$PORT$p")
    if [[ "$loc" == */ ]]; then ok "$p → 302 to / (page switched off in admin/superadmin — not published)"; else bad "$p → 302 to $loc"; fi
  else bad "$p → ${code:-no response}"; fi
done
# admin API must stay locked
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$PORT/admin/api/site")
if [ "$code" = "401" ] || [ "$code" = "403" ] || [ "$code" = "302" ]; then ok "/admin/api/site without login → $code (locked)"; else bad "/admin/api/site without login → $code (should be 401/403/302)"; fi

echo "== public URL"
PUB=$(node -e "require('./scripts/lib.cjs').loadPm2Env();const s=require('./src/store').getSite();console.log(require('./src/seo').baseUrl(s))" 2>/dev/null)
if [ -z "$PUB" ]; then
  warn "no public URL (set Site URL in Admin → SEO Wizard → Basics, or SITE_URL in ecosystem.config.cjs)"
else
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 -L "$PUB/")
  if [ "$code" = "200" ]; then ok "$PUB/ → 200"; else bad "$PUB/ → ${code:-no response} (tunnel/DNS/cert — run: node scripts/cutover-check.mjs $(echo "$PUB" | sed 's#https\?://##'))"; fi
fi

echo "== disk & data"
df -h --output=avail,pcent,target / 2>/dev/null | tail -n1 | awk '{print "  info root fs: "$1" free ("$2" used)"}'
[ -f data/site.json ] && ok "data/site.json present ($(stat -c %s data/site.json) bytes, modified $(stat -c %y data/site.json | cut -d. -f1))" || bad "data/site.json missing"
nb=$(ls data/backups 2>/dev/null | wc -l); echo "  info $nb automatic backups in data/backups/"

if [ "$QUICK" = 0 ]; then
  echo "== SEO audit"
  node scripts/seo-audit.mjs --port "$PORT" 2>&1 | sed -n '1,2p;/^== Search engine setup/,/^== Pages/{/FAIL/p}' | sed 's/^/  /'
fi

echo
[ $fail -eq 0 ] && echo "HEALTHY" || echo "PROBLEMS FOUND"
exit $fail
