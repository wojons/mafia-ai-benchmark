import { execFileSync } from "child_process";

/**
 * QA-MAFIA-AI-BENCHMARK-15-R2 — no tracked source may be git-ignored.
 *
 * packages/shared ships AUTHORED .js/.d.ts sources (the legacy engine and
 * several vitest suites require()/import them by path). `.gitignore` used to
 * carry blanket `packages/shared/src/**\/*.js` (+ .js.map/.d.ts/.d.ts.map)
 * patterns for "in-source compiler output". Tracked files stay tracked when an
 * ignore pattern lands later, so the working tree looked fine — but any
 * ignore-aware materialization of the tree dropped them:
 *
 *   git init && git add -A && git commit   # snapshot / act / QA-bunker sync
 *
 * and the clone built from that commit had no
 * packages/shared/src/agents/response-parser.js, so the server suite died with
 * "Cannot find module './packages/shared/src/agents/response-parser'".
 *
 * Two invariants keep that from recurring:
 *   1. no file tracked under packages/shared/src is matched by .gitignore (so a
 *      fresh `git add -A` snapshot keeps every source it found on disk);
 *   2. every authored non-TS source this package depends on is actually tracked
 *      in HEAD (so a tracked-only export — git archive / actions/checkout —
 *      materializes it).
 */

const SRC_PREFIX = "packages/shared/src";

/**
 * Authored sources that are NOT produced by the TypeScript build: pre-existing
 * CJS modules plus the hand-written .d.ts that types response-parser.js. If one
 * is deliberately retired, remove it here in the same change.
 */
const AUTHORED_SOURCES = [
  "packages/shared/src/agents/response-parser.js",
  "packages/shared/src/agents/response-parser.d.ts",
  "packages/shared/src/persona/persona-generator.js",
  "packages/shared/src/providers/player-model-config.js",
  "packages/shared/src/__tests__/game-engine/ultrathink-features.test.js",
  "packages/shared/src/__tests__/personas/persona-generator.test.js",
  "packages/shared/src/__tests__/personas/persona.test.js",
];

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Repo toplevel, or null when the tests run outside a git work tree. */
function resolveRepoRoot(): string | null {
  try {
    const root = git(["rev-parse", "--show-toplevel"], process.cwd()).trim();
    return root || null;
  } catch {
    return null;
  }
}

const REPO_ROOT = resolveRepoRoot();
const describeGit = REPO_ROOT ? describe : describe.skip;

describeGit("repository hygiene: tracked sources are never git-ignored", () => {
  it(`lists no tracked file under ${SRC_PREFIX} as ignored`, () => {
    const root = REPO_ROOT as string;
    // -c: cached (tracked), -i: ignored, --exclude-standard: honour .gitignore.
    // Every path this prints is a file a `git add -A` snapshot will NOT carry.
    const offenders = git(
      ["ls-files", "-ci", "--exclude-standard", "--", SRC_PREFIX],
      root,
    )
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const ruleReport = offenders
      .map((path) => {
        try {
          return `${git(["check-ignore", "-v", "--", path], root).trim()}  <- ${path}`;
        } catch {
          return `${path} (no rule reported by check-ignore)`;
        }
      })
      .join("\n");

    expect(
      offenders,
      `${offenders.length} tracked file(s) under ${SRC_PREFIX} are git-ignored and ` +
        "would be dropped by a snapshot/act materialization. Fix .gitignore so it " +
        "cannot match tracked sources:\n" +
        ruleReport,
    ).toEqual([]);
  });

  it("tracks every authored non-TS source in HEAD", () => {
    const root = REPO_ROOT as string;
    const missing = AUTHORED_SOURCES.filter((path) => {
      const tracked = git(
        ["ls-tree", "-r", "--name-only", "HEAD", "--", path],
        root,
      )
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      return !tracked.includes(path);
    });

    expect(
      missing,
      "these authored sources are referenced at runtime but absent from HEAD, so " +
        "a tracked-only export (git archive / actions/checkout) cannot run them: " +
        missing.join(", "),
    ).toEqual([]);
  });
});
