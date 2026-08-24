#!/usr/bin/env bash
# publish.sh — push the reviewed schedule JSON to GitHub.
# Run from inside your local clone of the saydalyti-data repo:
#   ./publish.sh
# The app sees the update within seconds (raw.githubusercontent.com).
set -e

cd "$(dirname "$0")"

if [ ! -d .git ]; then
  echo "❌ This folder is not a git repo. Run this from your saydalyti-data clone."
  exit 1
fi

git add cities.json schedules/
if git diff --cached --quiet; then
  echo "ℹ️  Nothing new to publish."
  exit 0
fi

MONTH=$(date +%Y-%m)
git commit -m "schedule update $MONTH"
git push origin main
echo "✅ Published! The app will pick this up immediately."
