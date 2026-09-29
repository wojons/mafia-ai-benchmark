#!/usr/bin/env bash
# Release script for mafia-ai-benchmark.
# Usage: scripts/release.sh [major|minor|patch|vX.Y.Z]
# Requires: gh authed, git clean, CI green on HEAD.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="wojons/mafia-ai-benchmark"

# 1. Repo state gates
[ -z "$(git status --porcelain -- . ':!.gitreins' ':!.coding-hermes')" ] || { echo "FAIL: dirty tree"; exit 1; }
git fetch origin --tags --quiet
[ -z "$(git ls-remote --tags origin | grep -v '\^{}')" ] || { echo "FAIL: tags already exist — never force-move"; exit 1; }
git rev-list --count origin/main..main | grep -qx 0 || { echo "FAIL: unpushed commits"; exit 1; }

# 2. Version source of truth = the 5 manifests (must agree)
V=$(node -p "require('./package.json').version")
for m in apps/cli apps/server apps/web packages/shared; do
  [ "$(node -p "require('./$m/package.json').version")" = "$V" ] || { echo "FAIL: $m version drift"; exit 1; }
done
grep -q "## \[$V\]" CHANGELOG.md || { echo "FAIL: CHANGELOG has no [$V] heading"; exit 1; }
grep -q '{{INSTALL_DATE}}' CHANGELOG.md && { echo "FAIL: unsubstituted changelog token"; exit 1; } || true

# 3. CI must be green on HEAD
SHA=$(git rev-parse HEAD)
LAST=$(gh run list --repo "$REPO" --branch main --limit 1 --json databaseId,headSha,conclusion \
  --jq ".[0] | select(.headSha==\"$SHA\") | .conclusion")
[ "$LAST" = "success" ] || { echo "FAIL: CI on HEAD $SHA is '$LAST'"; exit 1; }

# 4. Audit gate: 0 known prod vulnerabilities
OUT=$(pnpm audit --prod 2>&1); echo "$OUT" | grep -q "No known vulnerabilities found" \
  || { echo "FAIL: pnpm audit:\n$OUT"; exit 1; }

# 5. Build + verify the artifact (server + web images build clean)
pnpm --filter @mafia/shared --filter @mafia/server --filter @mafia/cli build >/dev/null
[ -f apps/server/dist/index.js ] || { echo "FAIL: server build missing"; exit 1; }

# 6. Tag + Release
TAG="v$V"
if [ "$1" != "$TAG" ] 2>/dev/null && [ "${1:-}" != "auto" ] && [ "${1:-x}" != "$TAG" ]; then
  echo "Note: requested '$1' but version line says $TAG — cutting $TAG"
fi
git tag -a "$TAG" -m "Release $TAG (mafia-ai-benchmark first public release; board rows RELEASE-001/003/004)"
git push origin "$TAG"
gh release create "$TAG" --repo "$REPO" --title "Release $TAG" --verify-tag \
  --notes-file <(sed -n "/## \[$V\]/,/^\[1.0.0\]:/p" CHANGELOG.md | sed '$d')
echo "RELEASED $TAG"
