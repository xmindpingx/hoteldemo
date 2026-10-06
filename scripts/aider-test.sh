#!/bin/bash
# Offline sanity check used by aider's /test (test-cmd in .aider.conf.yml).
# 1. node --check every JS file (syntax only, nothing executes)
# 2. require() the src/ modules in a throw-away DATA_DIR so the live data/ is never touched
# 3. confirm every EJS view parses
# Never starts the server and never touches pm2.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
fail=0

for f in server.js src/*.js scripts/*.mjs public/js/*.js public/admin/*.js; do
  [ -f "$f" ] || continue
  node --check "$f" || { echo "SYNTAX ERROR: $f"; fail=1; }
done

for f in scripts/*.sh start_aider.sh; do
  [ -f "$f" ] || continue
  bash -n "$f" || { echo "SHELL SYNTAX ERROR: $f"; fail=1; }
done

tmp=$(mktemp -d)
DATA_DIR="$tmp" node -e "
  for (const m of ['./src/store','./src/auth','./src/helpers','./src/icons','./src/seo','./src/public','./src/admin']) require(m);
  console.log('src/ modules load OK');
" || { echo "MODULE LOAD FAILED"; fail=1; }
rm -rf "$tmp"

node -e "
  const ejs = require('ejs'), fs = require('fs'), path = require('path');
  const walk = d => fs.readdirSync(d, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(d,e.name)) : e.name.endsWith('.ejs') ? [path.join(d,e.name)] : []);
  let bad = 0;
  for (const f of walk('views')) { try { ejs.compile(fs.readFileSync(f,'utf8'), {filename:f}); } catch (e) { bad++; console.error('EJS ERROR', f + ':', e.message.split('\n')[0]); } }
  if (bad) process.exit(1); console.log('views/ EJS templates compile OK');
" || fail=1

[ $fail -eq 0 ] && echo "ALL CHECKS PASSED"
exit $fail
