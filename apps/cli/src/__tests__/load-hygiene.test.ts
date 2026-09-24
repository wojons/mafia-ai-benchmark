/**
 * Test-suite load hygiene gate (DOC-3).
 *
 * Host-load contract for this package's suite: the number of child processes
 * spawned per suite run is bounded. benchmark.test.ts used to spawn a real
 * CLI process (tsx + TypeScript compile, ~500-900ms each) for every
 * parse-level assertion whose subject was the commander parse layer, not the
 * process boundary, plus a throwaway `node -e` child for the server probe.
 * The parse-level assertions are in-process now (same pattern as
 * run-game/list-games unit tests); the probe is an in-process fetch (same
 * pattern as apps/server api.test.ts). The remaining runCli call sites are
 * the assertions whose subject IS the process boundary: the live-report
 * stdout/exit-code behavior and the unreachable-server error path.
 *
 * This gate reads the suite source from disk (not inspect.getsource, which
 * returns drifted lines when files are edited mid-run) and fails if more
 * real-exec call sites appear than the bound allows.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import * as path from "path";

const source = readFileSync(
  path.resolve(__dirname, "./benchmark.test.ts"),
  "utf-8",
);

describe("test-suite load hygiene (DOC-3)", () => {
  it("keeps real-exec CLI spawn call sites within the load bound (<= 4)", () => {
    // Every `runCli(` occurrence minus the one function definition line.
    const occurrences = (source.match(/\brunCli\(/g) ?? []).length;
    const callSites = occurrences - 1;
    expect(callSites).toBeLessThanOrEqual(4);
  });

  it("probes the server in-process (no throwaway node child for the probe)", () => {
    expect(source).not.toContain("execFileSync");
  });
});
