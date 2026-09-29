# Release Policy — mafia-ai-benchmark

How this repo ships. The release surface is three layers, all required:

1. Annotated git tag `vX.Y.Z` on `origin/main` (never force-moved).
2. GitHub Release object with notes.
3. Docker images via `docker-compose.yml` (server :3004 + web :5174) —
   built locally from the tag; no registry pin today.

## Version authority

The version lives in 5 manifests: `package.json` + `apps/{cli,server,web}/package.json`
+ `packages/shared/package.json`. All must agree. `CHANGELOG.md`'s newest
`## [X.Y.Z]` heading must carry that same version with a real date
(`{{INSTALL_DATE}}` tokens are a release-blocking defect). The root manifest is
`private: true`, as are all workspace manifests — **nothing from this repo is
published to npm**; do not add a publish lane without updating this doc.

## Gates (enforced by `scripts/release.sh`)

- Working tree clean (board/gitreins lock files excluded).
- No existing tags (first-cut repo; tags are never force-moved).
- `main` fully pushed; CI run on HEAD sha is `success` (check per-job, an
  `all-clear`-style mask has not existed here — single `ci.yml` workflow).
- `pnpm audit --prod` reports zero known vulnerabilities.
- `pnpm build` of shared/server/cli succeeds.

## Semver policy

`feat` → minor, `fix` → patch, breaking API/CLI changes → major. Board rows
(RELEASE-*) authorize every cut; a readiness sweep row is not authorization.

## Pre-cut checklist

1. Land the prep commit: version stamp + changelog promotion (re-open
   `## [Unreleased]` after promoting) + any README tag references.
2. Push, wait for CI green on that exact sha.
3. Run `scripts/release.sh auto` (or hand-run the gates then tag).

## Rollback

Delete the Release object (`gh release delete vX.Y.Z`) and the remote tag
(`git push origin :refs/tags/vX.Y.Z`) — only if the tag must truly move;
the consumer path is tag-pinned docs. Previous release remains the fallback.

## History

- v1.0.0 — 2026-09-29 — first public release (RELEASE-001/003/004).
