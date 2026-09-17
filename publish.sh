#!/bin/bash
# Rebuilds the site and pushes it to the public GitHub Pages repo.
#   ./website/publish.sh
# First time: see website/README.md (creates ~/Projects/lockerbook.app).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${LOCKERBOOK_SITE_REPO:-$HOME/Projects/lockerbook.app}"

python3 "$SRC/build.py"

if [[ ! -d "$DEST/.git" ]]; then
  echo "No site repo at $DEST. Follow website/README.md step 2 first."
  exit 1
fi

rsync -a --delete --exclude '.git' --exclude 'build.py' --exclude 'publish.sh' --exclude 'README.md' "$SRC/" "$DEST/"
cd "$DEST"
git add -A
if git diff --cached --quiet; then
  echo "Site is already up to date."
else
  git commit -m "Update lockerbook.app"
  git push
  echo "Pushed. GitHub Pages updates in a minute or two."
fi
