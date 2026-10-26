#!/usr/bin/env bash
# Release script for mafia-ai-benchmark.
# Usage: scripts/release.sh [major|minor|patch|vX.Y.Z]
# Requires: gh authed, git clean, CI green on HEAD.
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REPO="wojons/mafia-ai-benchmark"

ensure_target_tag_available() {
  local tag=$1
  local remote_status

  if git show-ref --verify --quiet "refs/tags/$tag"; then
    echo "FAIL: target tag $tag already exists locally — tags are immutable" >&2
    return 1
  fi

  if git ls-remote --exit-code --refs origin "refs/tags/$tag" >/dev/null 2>&1; then
    echo "FAIL: target tag $tag already exists on origin — tags are immutable" >&2
    return 1
  else
    remote_status=$?
    if [ "$remote_status" -ne 2 ]; then
      echo "FAIL: unable to verify target tag $tag on origin (git ls-remote exited $remote_status)" >&2
      return 1
    fi
  fi
}

extract_release_notes() {
  local version=$1
  local changelog=${2:-CHANGELOG.md}

  awk -v version="$version" '
    /^## \[/ {
      heading = $0
      sub(/^## \[/, "", heading)
      sub(/\].*$/, "", heading)
      if (heading == version) {
        found = 1
        print
        next
      }
      if (found) {
        exit
      }
    }
    found { print }
    END {
      if (!found) {
        exit 1
      }
    }
  ' "$changelog"
}

main() {
  # 1. Repo state gates
  [ -z "$(git status --porcelain -- . ':!.gitreins' ':!.coding-hermes')" ] || { echo "FAIL: dirty tree"; exit 1; }
  git fetch origin --tags --quiet
  git rev-list --count origin/main..main | grep -qx 0 || { echo "FAIL: unpushed commits"; exit 1; }

  # 2. Version source of truth = the 5 manifests (must agree)
  V=$(node -p "require('./package.json').version")
  for m in apps/cli apps/server apps/web packages/shared; do
    [ "$(node -p "require('./$m/package.json').version")" = "$V" ] || { echo "FAIL: $m version drift"; exit 1; }
  done
  TAG="v$V"
  ensure_target_tag_available "$TAG"
  grep -q "## \[$V\]" CHANGELOG.md || { echo "FAIL: CHANGELOG has no [$V] heading"; exit 1; }
  grep -q '{{INSTALL_DATE}}' CHANGELOG.md && { echo "FAIL: unsubstituted changelog token"; exit 1; } || true

  # 3. CI must be green on HEAD
  SHA=$(git rev-parse HEAD)
  LAST=$(gh run list --repo "$REPO" --branch main --limit 1 --json databaseId,headSha,conclusion \
    --jq ".[0] | select(.headSha==\"$SHA\") | .conclusion")
  [ "$LAST" = "success" ] || { echo "FAIL: CI on HEAD $SHA is '$LAST'"; exit 1; }

  # 4. Audit gate: 0 known prod vulnerabilities
  OUT=$(pnpm audit --prod 2>&1); echo "$OUT" | grep -q "No known vulnerabilities found" \
    || { printf 'FAIL: pnpm audit:\n%s\n' "$OUT"; exit 1; }

  # 5. Build + verify the artifact (server + web images build clean)
  pnpm --filter @mafia/shared --filter @mafia/server --filter @mafia/cli build >/dev/null
  [ -f apps/server/dist/index.js ] || { echo "FAIL: server build missing"; exit 1; }

  # 6. Tag + Release
  if [ "${1:-}" != "$TAG" ] && [ "${1:-}" != "auto" ]; then
    echo "Note: requested '${1:-}' but version line says $TAG — cutting $TAG"
  fi
  git tag -a "$TAG" -m "Release $TAG (mafia-ai-benchmark first public release; board rows RELEASE-001/003/004)"
  git push origin "$TAG"
  gh release create "$TAG" --repo "$REPO" --title "Release $TAG" --verify-tag \
    --notes-file <(extract_release_notes "$V" CHANGELOG.md)
  echo "RELEASED $TAG"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
