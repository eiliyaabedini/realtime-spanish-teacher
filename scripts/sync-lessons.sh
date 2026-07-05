#!/usr/bin/env bash
# Copies lesson scripts from the Android repo (source of truth) into this app.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$REPO_ROOT/../LanguageLearningApp/app/src/main/assets/lessons}"
DEST="$REPO_ROOT/lib/lessons/content"

if [ ! -f "$SRC/index.json" ]; then
  echo "error: $SRC does not look like the Android lessons directory" >&2
  exit 1
fi

mkdir -p "$DEST"
rsync -a --delete "$SRC/" "$DEST/"
echo "Synced $(ls "$DEST" | wc -l | tr -d ' ') files from $SRC"
