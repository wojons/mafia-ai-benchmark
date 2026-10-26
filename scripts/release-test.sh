#!/usr/bin/env bash
# Deterministic, side-effect-free checks for scripts/release.sh helpers.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/release.sh"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

REPO_DIR="$TMP_DIR/repo"
REMOTE_DIR="$TMP_DIR/remote.git"
git init --bare -q "$REMOTE_DIR"
git init -q "$REPO_DIR"
git -C "$REPO_DIR" config user.email release-test@example.invalid
git -C "$REPO_DIR" config user.name release-test
printf '%s\n' base >"$REPO_DIR/file"
git -C "$REPO_DIR" add file
git -C "$REPO_DIR" commit -qm base
git -C "$REPO_DIR" branch -M main
git -C "$REPO_DIR" remote add origin "$REMOTE_DIR"
git -C "$REPO_DIR" push -q -u origin main

git -C "$REPO_DIR" tag v1.0.0
git -C "$REPO_DIR" push -q origin v1.0.0
local_tags_before=$(git -C "$REPO_DIR" tag --list)
if ! (cd "$REPO_DIR" && ensure_target_tag_available v1.1.0 >/dev/null 2>&1); then
  printf '%s\n' 'FAIL: previous tags must not block a new target tag' >&2
  exit 1
fi
[[ "$(git -C "$REPO_DIR" tag --list)" == "$local_tags_before" ]]

# A local target collision is rejected without changing local refs.
git -C "$REPO_DIR" tag v1.1.0
local_tags_before=$(git -C "$REPO_DIR" tag --list)
if (cd "$REPO_DIR" && ensure_target_tag_available v1.1.0 >/dev/null 2>&1); then
  printf '%s\n' 'FAIL: existing local target tag was accepted' >&2
  exit 1
fi
[[ "$(git -C "$REPO_DIR" tag --list)" == "$local_tags_before" ]]
git -C "$REPO_DIR" tag -d v1.1.0 >/dev/null

# A remote-only target collision is also rejected without changing local refs.
commit=$(git -C "$REPO_DIR" rev-parse HEAD)
git --git-dir="$REMOTE_DIR" update-ref refs/tags/v1.1.0 "$commit"
local_tags_before=$(git -C "$REPO_DIR" tag --list)
if (cd "$REPO_DIR" && ensure_target_tag_available v1.1.0 >/dev/null 2>&1); then
  printf '%s\n' 'FAIL: existing remote target tag was accepted' >&2
  exit 1
fi
[[ "$(git -C "$REPO_DIR" tag --list)" == "$local_tags_before" ]]

CHANGELOG_FIXTURE="$TMP_DIR/CHANGELOG.md"
printf '%s\n' \
  '# Changelog' \
  '' \
  '## [Unreleased]' \
  '' \
  '## [2.0.0] — 2026-01-01' \
  '' \
  'Target release notes.' \
  '' \
  '### Fixed' \
  '' \
  '- Target-only fix.' \
  '' \
  '## [1.1.0] — 2025-12-01' \
  '' \
  'Older release notes must not be included.' \
  '' \
  '[2.0.0]: https://example.invalid/releases/tag/v2.0.0' \
  '[1.1.0]: https://example.invalid/releases/tag/v1.1.0' \
  >"$CHANGELOG_FIXTURE"

notes=$(extract_release_notes 2.0.0 "$CHANGELOG_FIXTURE")
expected=$(printf '%s\n' \
  '## [2.0.0] — 2026-01-01' \
  '' \
  'Target release notes.' \
  '' \
  '### Fixed' \
  '' \
  '- Target-only fix.')
[[ "$notes" == "$expected" ]]
assert_not_contains() {
  if grep -Fq "$1" <<<"$2"; then
    printf 'FAIL: extracted notes unexpectedly contain %s\n' "$1" >&2
    exit 1
  fi
}
assert_not_contains '## [1.1.0]' "$notes"
assert_not_contains 'Older release notes' "$notes"
assert_not_contains '[2.0.0]:' "$notes"

printf '%s\n' 'PASS: repeatable release tag gate and changelog section extraction'
