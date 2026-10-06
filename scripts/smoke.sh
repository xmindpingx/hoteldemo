#!/bin/bash
# End-to-end smoke test that is SAFE for aider to run: boots a throwaway copy of the server on a free
# port with a temporary DATA_DIR (seeded from data/defaults.json), requests every public route and the
# admin login, logs in with the default passphrase and calls the SEO preview + audit API, then kills
# the copy and deletes the temp dir. The live pm2 process and data/ are never touched.
#
#   bash scripts/smoke.sh          # ~5-10 s. Exit 0 = all good, 1 = a route or API failed (details printed)
#   bash scripts/smoke.sh --keep   # leave the temp server running and print its port (for manual poking)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
KEEP=0; [ "${1:-}" = "--keep" ] && KEEP=1
fail=0
ok()  { printf '  PASS %s\n' "$*"; }
bad() { printf '  FAIL %s\n' "$*"; fail=1; }

# free port in 18100-18999
PORT=$(node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
TMP=$(mktemp -d /tmp/hoteldemo-smoke.XXXXXX)
LOG="$TMP/server.log"
cleanup() {
  if [ "$KEEP" = 0 ]; then
    [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null
    rm -rf "$TMP"
  else
    echo "left running: http://127.0.0.1:$PORT  (pid $PID, data in $TMP) — kill $PID when done"
  fi
}
trap cleanup EXIT

PORT="$PORT" DATA_DIR="$TMP/data" SITE_URL="http://127.0.0.1:$PORT" NODE_ENV=production node server.js > "$LOG" 2>&1 &
PID=$!
for i in $(seq 1 40); do curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$PORT/robots.txt" && break; sleep 0.25; done
if ! kill -0 "$PID" 2>/dev/null; then echo "server exited at startup:"; cat "$LOG"; exit 1; fi
echo "smoke server on 127.0.0.1:$PORT (temp data in $TMP)"

echo "== public routes"
SLUG=$(node -e "const d=require('./data/defaults.json');const r=(d.rooms.items||[]).find(x=>x.enabled!==false);console.log(r?r.slug:'')")
for p in / /suites "/suites/$SLUG" /amenities /dining /area /gallery /contact /robots.txt /sitemap.xml /admin/login; do
  [ "$p" = "/suites/" ] && continue
  code=$(curl -s -o "$TMP/body" -w '%{http_code}' --max-time 8 -H 'x-seo-audit: 1' "http://127.0.0.1:$PORT$p")
  if [ "$code" = "200" ]; then
    # every HTML page must have exactly one <title>, a description, and a canonical when SITE_URL is set
    if grep -q '<html' "$TMP/body" && [[ "$p" != /admin* ]]; then
      t=$(grep -o '<title>' "$TMP/body" | wc -l); d=$(grep -c 'name="description"' "$TMP/body"); c=$(grep -c 'rel="canonical"' "$TMP/body")
      if [ "$t" = 1 ] && [ "$d" -ge 1 ] && [ "$c" -ge 1 ]; then ok "$p → 200 (title, description, canonical)"; else bad "$p → 200 but title=$t description=$d canonical=$c"; fi
    else ok "$p → 200"; fi
  else bad "$p → $code"; fi
done
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$PORT/no-such-page-xyz")
[ "$code" = "404" ] && ok "/no-such-page-xyz → 404" || bad "/no-such-page-xyz → $code (expected 404)"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$PORT/suites/")
[ "$code" = "301" ] && ok "/suites/ → 301 (trailing slash)" || bad "/suites/ → $code (expected 301)"

echo "== admin API"
CK="$TMP/cookies"
code=$(curl -s -c "$CK" -o /dev/null -w '%{http_code}' --max-time 8 -X POST -d 'passphrase=hoteldemo' "http://127.0.0.1:$PORT/admin/login")
[ "$code" = "302" ] && ok "login with default passphrase → 302" || bad "login → $code"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$PORT/admin/api/site")
[ "$code" = "401" ] && ok "/admin/api/site without cookie → 401" || bad "/admin/api/site without cookie → $code"
code=$(curl -s -b "$CK" -o "$TMP/site.json" -w '%{http_code}' --max-time 8 -H 'X-Requested-With: fetch' "http://127.0.0.1:$PORT/admin/api/site")
[ "$code" = "200" ] && ok "GET /admin/api/site → 200" || bad "GET /admin/api/site → $code"
node -e "const s=require('$TMP/site.json');require('fs').writeFileSync('$TMP/prev.json',JSON.stringify({site:s,page:'home'}))"
code=$(curl -s -b "$CK" -o "$TMP/preview.json" -w '%{http_code}' --max-time 15 -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' --data-binary "@$TMP/prev.json" "http://127.0.0.1:$PORT/admin/api/seo/preview")
if [ "$code" = "200" ] && node -e "const r=require('$TMP/preview.json');if(!r.meta.title||!Array.isArray(r.jsonLd))process.exit(1)"; then ok "POST /admin/api/seo/preview → title + JSON-LD"; else bad "seo/preview → $code"; fi
code=$(curl -s -b "$CK" -o "$TMP/audit.json" -w '%{http_code}' --max-time 60 -H 'X-Requested-With: fetch' "http://127.0.0.1:$PORT/admin/api/seo/audit")
if [ "$code" = "200" ]; then
  score=$(node -e "const r=require('$TMP/audit.json');console.log(r.score+' ('+r.summary.pass+' pass, '+r.summary.warn+' warn, '+r.summary.fail+' fail, '+r.pages.length+' pages)')")
  ok "GET /admin/api/seo/audit → score $score  [default content, temp URL — not the live score]"
else bad "seo/audit → $code"; fi
# a save round-trip must not change anything on a clean dataset
code=$(curl -s -b "$CK" -o /dev/null -w '%{http_code}' --max-time 15 -X PUT -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' --data-binary "@$TMP/site.json" "http://127.0.0.1:$PORT/admin/api/site")
[ "$code" = "200" ] && ok "PUT /admin/api/site (save round-trip) → 200" || bad "PUT /admin/api/site → $code"

if grep -qiE "error|unhandled" "$LOG"; then echo "== server log has errors:"; grep -iE "error|unhandled" "$LOG" | head -20; fail=1; fi
echo
[ $fail -eq 0 ] && echo "SMOKE PASSED" || echo "SMOKE FAILED"
exit $fail
