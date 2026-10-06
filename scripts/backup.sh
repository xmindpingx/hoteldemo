#!/bin/bash
# Full content backup/restore for the hotel site: everything that is NOT in git.
#   data/site.json, data/inquiries.json, data/admin.json, data/.secret, public/uploads/
# (data/backups/ is the admin panel's own rolling 30-save history and is included too.)
#
#   bash scripts/backup.sh                       # → /home/dad/wwwhotel/backups/hoteldemo-YYYYMMDD-HHMMSS.tgz, keeps the last 14
#   bash scripts/backup.sh --dir /some/where     # different destination
#   bash scripts/backup.sh --restore <file.tgz>  # restore (current content is backed up first, then pm2 restart is needed)
#
# Put it in cron for a nightly copy:   5 3 * * * /bin/bash /home/dad/wwwhotel/hoteldemosite/scripts/backup.sh >> /home/dad/logs/hoteldemo-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=$(pwd)
DEST="${BACKUP_DIR:-$(dirname "$REPO")/backups}"
KEEP=14

if [ "${1:-}" = "--dir" ]; then DEST="$2"; shift 2; fi

if [ "${1:-}" = "--restore" ]; then
  src="${2:?usage: backup.sh --restore <file.tgz>}"
  [ -f "$src" ] || { echo "no such file: $src"; exit 1; }
  echo "Backing up current content first..."
  "$0" --dir "$DEST"
  echo "Restoring $src into $REPO ..."
  tar -xzf "$src" -C "$REPO"
  echo "Restored. Now run:  pm2 restart hoteldemo   (the server caches site.json in memory)"
  exit 0
fi

mkdir -p "$DEST"
stamp=$(date +%Y%m%d-%H%M%S)
out="$DEST/hoteldemo-$stamp.tgz"
items=()
for p in data/site.json data/inquiries.json data/admin.json data/.secret data/backups public/uploads; do [ -e "$p" ] && items+=("$p"); done
tar -czf "$out" "${items[@]}"
echo "wrote $out ($(du -h "$out" | cut -f1))"
# prune
ls -1t "$DEST"/hoteldemo-*.tgz 2>/dev/null | tail -n +$((KEEP+1)) | while read -r f; do rm -f "$f"; echo "pruned $f"; done
