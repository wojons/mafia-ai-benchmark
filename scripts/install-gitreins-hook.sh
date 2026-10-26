#!/usr/bin/env bash
# Install the repository-owned GitReins pre-commit hook for this checkout.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK_DIR="$REPO_ROOT/scripts/githooks"
HOOK="$HOOK_DIR/pre-commit"

if [[ ! -x "$HOOK" ]]; then
  printf 'error: expected executable hook is missing: %s\n' "$HOOK" >&2
  exit 1
fi

# A linked worktree needs its own config file; never write a shared common
# .git/config while installing from an isolated worktree.
git_dir="$(git -C "$REPO_ROOT" rev-parse --git-dir)"
common_dir="$(git -C "$REPO_ROOT" rev-parse --git-common-dir)"
if [[ "$git_dir" != "$common_dir" ]]; then
  if [[ "$(git -C "$REPO_ROOT" config --get extensions.worktreeConfig || true)" != "true" ]]; then
    printf 'error: linked worktree config is not enabled; run this installer from a normal checkout or enable extensions.worktreeConfig first\n' >&2
    exit 1
  fi
  git -C "$REPO_ROOT" config --worktree core.hooksPath "$HOOK_DIR"
else
  git -C "$REPO_ROOT" config --local core.hooksPath "$HOOK_DIR"
fi

if [[ "${1:-}" == "--check" ]]; then
  resolved="$(git -C "$REPO_ROOT" config --path --get core.hooksPath || true)"
  case "$resolved" in
    /var/tmp/*|/tmp/*)
      printf 'error: core.hooksPath resolves to temporary path: %s\n' "$resolved" >&2
      exit 1
      ;;
  esac
  if [[ "$resolved" != "$HOOK_DIR" ]]; then
    printf 'error: core.hooksPath resolved to %s, expected %s\n' "$resolved" "$HOOK_DIR" >&2
    exit 1
  fi
  printf 'core.hooksPath=%s\nhook=%s\n' "$resolved" "$HOOK"
fi
