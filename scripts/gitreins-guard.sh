#!/usr/bin/env bash
# Run the repository's GitReins guard, widening dependency changes to full tests.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# A dependency manifest can change the behavior of any workspace package, so
# diff-mode test selection is unsafe for these paths. Keep ordinary source
# changes on GitReins' existing diff-mode path.
run_full_tests=false
while IFS= read -r staged_path; do
  case "$staged_path" in
    package.json|*/package.json|pnpm-lock.yaml|*/pnpm-lock.yaml)
      run_full_tests=true
      break
      ;;
  esac
done < <(git diff --cached --name-only --diff-filter=ACMRT)

if [[ "$run_full_tests" == true ]]; then
  exec gitreins guard --full
fi

exec gitreins guard
