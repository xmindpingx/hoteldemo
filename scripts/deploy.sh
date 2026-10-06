#!/bin/bash
# Deploy the latest commit from GitHub to this server and restart. FOR THE HUMAN TO RUN (aider must
# not run pm2/npm install/git pull itself — see CONVENTIONS.md). Safe order: backup → pull → install
# → offline tests → restart → health check. Stops at the first failure so a broken build never
# replaces a working one.
#
#   bash scripts/deploy.sh            # pull origin/main, test, restart, health
#   bash scripts/deploy.sh --local    # skip the git pull: deploy the working tree as it is (after aider edits)
#   bash scripts/deploy.sh --no-test  # (not recommended) skip scripts/aider-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PULL=1; TEST=1
for a in "$@"; do case "$a" in --local) PULL=0 ;; --no-test) TEST=0 ;; esac; done
say() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }

say "1/6 backing up live content"
bash scripts/backup.sh

if [ "$PULL" = 1 ]; then
  say "2/6 pulling origin/main"
  if [ -n "$(git status --porcelain)" ]; then
    echo "Working tree has uncommitted changes:"; git status --short
    echo "Commit them (aider does this automatically) or run with --local to deploy the tree as-is."; exit 1
  fi
  git fetch origin
  git merge --ff-only origin/main
else
  say "2/6 --local: deploying the working tree at $(git rev-parse --short HEAD)"
fi

say "3/6 npm install --omit=dev"
npm install --omit=dev --no-audit --no-fund

if [ "$TEST" = 1 ]; then
  say "4/6 offline tests (scripts/aider-test.sh)"
  bash scripts/aider-test.sh
else
  say "4/6 tests skipped (--no-test)"
fi

say "5/6 pm2 restart hoteldemo"
if pm2 describe hoteldemo >/dev/null 2>&1; then pm2 restart hoteldemo --update-env; else pm2 start ecosystem.config.cjs && pm2 save; fi
sleep 2

say "6/6 health check"
bash scripts/health.sh --quick
say "deployed $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"
