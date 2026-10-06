#!/bin/bash
# End-to-end smoke test for the superadmin / feature-gating system. Safe for aider to run: boots a
# throwaway copy of the server on a free port with a temporary DATA_DIR, exercises the superadmin
# login, feature toggles, public-site + hotel-admin enforcement, locked panels, passphrase reset,
# and upload-size limit — then kills the copy and deletes the temp dir. Live pm2/data/ untouched.
#
#   bash scripts/smoke-superadmin.sh          # ~5-10 s. Exit 0 = all good, 1 = a check failed
#   bash scripts/smoke-superadmin.sh --keep   # leave the temp server running, print its port
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
KEEP=0; [ "${1:-}" = "--keep" ] && KEEP=1
fail=0
ok()  { printf '  PASS %s\n' "$*"; }
bad() { printf '  FAIL %s\n' "$*"; fail=1; }

PORT=$(node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
TMP=$(mktemp -d /tmp/hoteldemo-smoke-super.XXXXXX)
LOG="$TMP/server.log"
JAR="$TMP/cookies.txt"
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
B="http://127.0.0.1:$PORT"

echo "== superadmin auth"
code=$(curl -s -o "$TMP/body" -w '%{http_code}' --max-time 8 "$B/superadmin/login")
[ "$code" = "200" ] && ok "/superadmin/login → 200" || bad "/superadmin/login → $code"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -c "$JAR" -X POST "$B/superadmin/api/features" -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' -d '{}')
[ "$code" = "401" ] && ok "superadmin API without cookie → 401" || bad "superadmin API without cookie → $code"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -c "$JAR" -X POST "$B/superadmin/login" -d 'passphrase=wrong-pass')
[ "$code" = "401" ] && ok "superadmin login wrong passphrase → 401" || bad "superadmin login wrong passphrase → $code"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -c "$JAR" -X POST "$B/superadmin/login" -d 'passphrase=hotelsuper')
[ "$code" = "302" ] && ok "superadmin login with default passphrase → 302" || bad "superadmin login with default passphrase → $code"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -b "$JAR" "$B/superadmin")
[ "$code" = "200" ] && ok "GET /superadmin with cookie → 200" || bad "GET /superadmin with cookie → $code"

echo "== superadmin can also open hotel admin without its passphrase"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -b "$JAR" "$B/admin/api/site" -H 'X-Requested-With: fetch')
[ "$code" = "200" ] && ok "super cookie opens /admin/api/site → 200" || bad "super cookie opens /admin/api/site → $code"

echo "== feature toggles enforced on public site + hotel admin"
curl -s --max-time 8 -o "$TMP/feat.json" -b "$JAR" "$B/superadmin/api/features"
node -e "
  const d = require('$TMP/feat.json');
  if (!d.features || !Array.isArray(d.catalog)) { console.error('bad /features shape'); process.exit(1); }
  console.log('catalog has', d.catalog.length, 'features');
" && ok "GET /superadmin/api/features returns catalog + state" || bad "GET /superadmin/api/features shape"

# disable the Gallery page feature and Amenities page feature, set a price/note, save
node -e "
  const fs = require('fs');
  const d = JSON.parse(fs.readFileSync('$TMP/feat.json', 'utf8'));
  const f = d.features;
  f.flags['page.gallery'] = false;
  f.flags['page.amenities'] = false;
  f.meta['page.gallery'] = { price: '\$9/mo', note: 'Ask about our gallery add-on' };
  f.planName = 'Starter';
  fs.writeFileSync('$TMP/feat-update.json', JSON.stringify(f));
"
code=$(curl -s -o "$TMP/put.json" -w '%{http_code}' --max-time 8 -b "$JAR" -X PUT "$B/superadmin/api/features" -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' --data-binary "@$TMP/feat-update.json")
[ "$code" = "200" ] && ok "PUT /superadmin/api/features → 200" || bad "PUT /superadmin/api/features → $code"

code=$(curl -s -o "$TMP/gallery.html" -w '%{http_code}' --max-time 8 "$B/gallery")
[ "$code" = "302" ] && ok "/gallery → 302 (sectionGuard redirect home) once page.gallery disabled" || bad "/gallery → $code (expected 302)"

code=$(curl -s -o "$TMP/amenities.html" -w '%{http_code}' --max-time 8 "$B/amenities")
[ "$code" = "302" ] && ok "/amenities → 302 (sectionGuard redirect home) once page.amenities disabled" || bad "/amenities → $code (expected 302)"

code=$(curl -s -o "$TMP/home.html" -w '%{http_code}' --max-time 8 "$B/")
if [ "$code" = "200" ]; then
  if grep -qi 'href="/gallery"' "$TMP/home.html" || grep -qi 'href="/amenities"' "$TMP/home.html"; then
    bad "/ still links to disabled pages"
  else
    ok "/ → 200, nav/footer links to disabled pages removed"
  fi
else bad "/ → $code"; fi

code=$(curl -s -o "$TMP/sitemap.xml" -w '%{http_code}' --max-time 8 "$B/sitemap.xml")
if [ "$code" = "200" ] && ! grep -q '/gallery' "$TMP/sitemap.xml" && ! grep -q '/amenities' "$TMP/sitemap.xml"; then
  ok "/sitemap.xml excludes disabled pages"
else bad "/sitemap.xml still lists a disabled page (code=$code)"; fi

echo "== page off + limit on the same section, contact page off (apply() regressions)"
node -e "
  const fs = require('fs');
  const f = JSON.parse(fs.readFileSync('$TMP/feat-update.json', 'utf8'));   // keeps gallery/amenities off + the price meta
  f.flags['page.suites'] = false; f.limits.maxRooms = 1;   // a limit must never re-enable a page that is off
  f.flags['page.contact'] = false;                          // no contact page + inquiry mode → CTA becomes tel:
  fs.writeFileSync('$TMP/feat-combo.json', JSON.stringify(f));
"
curl -s -o /dev/null --max-time 8 -b "$JAR" -X PUT "$B/superadmin/api/features" -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' --data-binary "@$TMP/feat-combo.json"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$B/suites")
[ "$code" = "302" ] && ok "/suites still redirects when page.suites is off AND maxRooms is set" || bad "/suites → $code with page.suites off + maxRooms=1 (limit re-enabled the page?)"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$B/contact")
[ "$code" = "302" ] && ok "/contact redirects when page.contact is off" || bad "/contact → $code (expected 302)"
curl -s --max-time 8 -o "$TMP/home2.html" "$B/"
if grep -q 'href="/suites' "$TMP/home2.html"; then bad "/ still has a call-to-action pointing at /suites (hero/promo CTA not scrubbed)"; else ok "/ has no hero/promo CTA pointing at the disabled /suites page"; fi
if grep -q 'href="/contact' "$TMP/home2.html"; then bad "/ still links to the disabled /contact page"; else ok "/ has no link to the disabled /contact page"; fi
grep -q 'href="tel:' "$TMP/home2.html" && ok "\"Check Availability\" falls back to a tel: link" || bad "no tel: fallback for the booking button when the contact page is off"
grep -q 'data-booking-bar' "$TMP/home2.html" && bad "hero booking bar (a form posting to /contact) still rendered with the contact page off" || ok "hero booking bar hidden with the contact page off"
curl -s --max-time 8 -o "$TMP/sitemap2.xml" "$B/sitemap.xml"
grep -q '/suites' "$TMP/sitemap2.xml" && bad "/sitemap.xml still lists /suites or room pages" || ok "/sitemap.xml has no suites/room URLs"

echo "== hotel admin reflects the lock"
code=$(curl -s -o "$TMP/admeta.json" -w '%{http_code}' --max-time 8 -b "$JAR" "$B/admin/api/meta" -H 'X-Requested-With: fetch')
if [ "$code" = "200" ]; then
  node -e "
    const d = require('$TMP/admeta.json');
    const locked = (d.features && d.features.locked || []).map(l => l.id);
    if (locked.includes('page.gallery') && locked.includes('page.amenities')) {
      const g = (d.features.locked || []).find(l => l.id === 'page.gallery');
      if (g && g.price === '\$9/mo') { console.log('OK'); process.exit(0); }
      console.error('price/note missing on locked entry'); process.exit(1);
    }
    console.error('locked list missing expected ids:', locked); process.exit(1);
  " && ok "/admin/api/meta.features.locked lists page.gallery + page.amenities with price" || bad "/admin/api/meta locked-feature shape"
else bad "/admin/api/meta → $code"; fi

echo "== admin.datasets gate (reset endpoint)"
node -e "
  const fs = require('fs');
  const f = JSON.parse(fs.readFileSync('$TMP/feat.json', 'utf8')).features;
  f.flags['admin.datasets'] = false;
  fs.writeFileSync('$TMP/feat-update2.json', JSON.stringify(f));
"
curl -s -o /dev/null --max-time 8 -b "$JAR" -X PUT "$B/superadmin/api/features" -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' --data-binary "@$TMP/feat-update2.json"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -b "$JAR" -X POST "$B/admin/api/reset" -H 'X-Requested-With: fetch')
[ "$code" = "403" ] && ok "POST /admin/api/reset → 403 once admin.datasets disabled" || bad "POST /admin/api/reset → $code (expected 403)"

echo "== upload size-limit enforcement"
node -e "
  const fs = require('fs');
  const f = JSON.parse(fs.readFileSync('$TMP/feat.json', 'utf8')).features;
  f.limits.maxUploadMb = 1;
  fs.writeFileSync('$TMP/feat-update3.json', JSON.stringify(f));
"
curl -s -o /dev/null --max-time 8 -b "$JAR" -X PUT "$B/superadmin/api/features" -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' --data-binary "@$TMP/feat-update3.json"
node -e "fs=require('fs');fs.writeFileSync('$TMP/big.bin', Buffer.alloc(2*1024*1024, 1))"
code=$(curl -s -o "$TMP/upload.json" -w '%{http_code}' --max-time 8 -b "$JAR" -X POST "$B/admin/api/upload" -H 'X-Requested-With: fetch' -F "files=@$TMP/big.bin;type=image/png")
if [ "$code" = "400" ] && grep -qi 'larger\|allowed' "$TMP/upload.json"; then
  ok "2MB upload rejected with maxUploadMb=1 → 400"
else
  bad "2MB upload with maxUploadMb=1 → $code, body: $(cat "$TMP/upload.json")"
fi

echo "== passphrase changes"
curl -s -o /dev/null --max-time 8 -c "$TMP/jarA.txt" -X POST "$B/admin/login" -d 'passphrase=hoteldemo'
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -b "$TMP/jarA.txt" "$B/admin/api/site" -H 'X-Requested-With: fetch')
[ "$code" = "200" ] && ok "hotel admin session (default passphrase) works before the reset" || bad "hotel admin login before reset → $code"

code=$(curl -s -o "$TMP/pw0.json" -w '%{http_code}' --max-time 8 -b "$JAR" -X POST "$B/superadmin/api/admin-passphrase" -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' -d '{"next":"hotelsuper"}')
[ "$code" = "400" ] && ok "vendor cannot set the hotel passphrase equal to the superadmin passphrase → 400" || bad "hotel passphrase = super passphrase accepted → $code"

code=$(curl -s -o "$TMP/pw1.json" -w '%{http_code}' --max-time 8 -b "$JAR" -X POST "$B/superadmin/api/admin-passphrase" -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' -d '{"next":"newhotelpass"}')
[ "$code" = "200" ] && ok "superadmin resets hotel admin passphrase → 200" || bad "reset hotel admin passphrase → $code"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -b "$TMP/jarA.txt" "$B/admin/api/site" -H 'X-Requested-With: fetch')
[ "$code" = "401" ] && ok "the hotel admin session from before the reset is signed out → 401" || bad "old hotel admin session still valid after reset → $code"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -c "$TMP/jar2.txt" -X POST "$B/admin/login" -d 'passphrase=newhotelpass')
[ "$code" = "302" ] && ok "hotel admin logs in with the newly-set passphrase → 302" || bad "hotel admin login with new passphrase → $code"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -c "$TMP/jar3.txt" -X POST "$B/admin/login" -d 'passphrase=hoteldemo')
[ "$code" != "302" ] && ok "old hotel admin passphrase no longer works" || bad "old hotel admin passphrase still works (should be invalidated)"

code=$(curl -s -o "$TMP/pw2.json" -w '%{http_code}' --max-time 8 -b "$JAR" -X POST "$B/superadmin/api/passphrase" -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' -d '{"current":"wrongcurrent","next":"newsuperpass123"}')
[ "$code" = "400" ] && ok "superadmin passphrase change with wrong current → 400" || bad "superadmin passphrase change wrong current → $code"

cp "$JAR" "$TMP/jar-super-old.txt"
code=$(curl -s -o "$TMP/pw3.json" -w '%{http_code}' --max-time 8 -b "$JAR" -c "$JAR" -X POST "$B/superadmin/api/passphrase" -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' -d '{"current":"hotelsuper","next":"newsuperpass123"}')
[ "$code" = "200" ] && ok "superadmin passphrase change with correct current → 200" || bad "superadmin passphrase change correct current → $code, body: $(cat "$TMP/pw3.json")"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -b "$TMP/jar-super-old.txt" "$B/superadmin/api/features")
[ "$code" = "401" ] && ok "previous superadmin session is signed out after the change → 401" || bad "old superadmin session still valid → $code"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -b "$JAR" "$B/superadmin/api/features")
[ "$code" = "200" ] && ok "the session that changed the passphrase stays signed in (refreshed cookie) → 200" || bad "refreshed superadmin cookie rejected → $code"

echo "== enable-all restores everything"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -b "$JAR" -X POST "$B/superadmin/api/features/all" -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' -d '{"enabled":true}')
[ "$code" = "200" ] && ok "POST /superadmin/api/features/all enabled=true → 200" || bad "features/all enable → $code"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$B/gallery")
[ "$code" = "200" ] && ok "/gallery → 200 again after enable-all" || bad "/gallery → $code after enable-all (expected 200)"

[ $fail -eq 0 ] && echo "SMOKE (SUPERADMIN) PASSED"
exit $fail
