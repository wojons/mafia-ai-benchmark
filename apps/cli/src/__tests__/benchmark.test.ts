/**
 * Tests for BenchmarkCommand (MAF-GAP-010 / MAF-GAP-015).
 *
 * The command must display the REAL accumulated benchmark report fetched from
 * the server — never fabricated Math.random numbers. With --games/--models it
 * now POSTs a fresh run and polls it to completion (MAF-GAP-015).
 *
 * Load hygiene (DOC-3): parse-level assertions run IN-PROCESS against a
 * BenchmarkCommand instance (same pattern as run-game/list-games unit tests).
 * Spawning the real CLI (`node tsx-cli src/index.ts ...`) is reserved for the
 * assertions whose subject IS the process boundary — live-report
 * stdout/exit-code behavior and the unreachable-server error path — plus the
 * dedicated real-exec parity suite in parse.test.ts. The server probe is an
 * in-process fetch (same pattern as apps/server api.test.ts), not a
 * throwaway `node -e` child.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtempSync, existsSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { createRequire } from "module";
import { BenchmarkCommand } from "../commands/benchmark";

const execFileAsync = promisify(execFile);
const nodeRequire = createRequire(__filename);

// Resolve the tsx CLI entry (devDependency of @mafia/cli) and the CLI entry point.
const tsxCli = nodeRequire.resolve("tsx/cli");
const cliEntry = path.resolve(__dirname, "../index.ts");

const TEST_BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3004";

const tmpDirs: string[] = [];

function makeTempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mafiactl-benchmark-"));
  tmpDirs.push(dir);
  return dir;
}

async function runCli(
  cwd: string,
  args: string[],
  timeoutMs = 60000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [tsxCli, cliEntry, ...args],
      { cwd, env: process.env, timeout: timeoutMs },
    );
    return { stdout, stderr, code: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      code: typeof error.code === "number" ? error.code : 1,
    };
  }
}

type CliResult = { stdout: string; stderr: string; code: number };

/**
 * Parse argv against a fresh in-process BenchmarkCommand (no subprocess).
 * Returns the command's stdout/stderr plus its exit code:
 * - --help → commander's exitOverride yields exitCode 0 and the help text.
 * - the action's own failure path (invalid --timeout, unreachable server)
 *   calls process.exit(1) — stubbed here so the code is captured instead of
 *   terminating the vitest worker.
 * `captureConsole` additionally mirrors console.log/console.error into the
 * result (the action prints via console, not commander's configured output).
 */
async function parseInProcess(
  args: string[],
  captureConsole = false,
): Promise<CliResult> {
  const cmd = new BenchmarkCommand();
  const out: string[] = [];
  const err: string[] = [];
  cmd.configureOutput({
    writeOut: (str) => out.push(str),
    writeErr: (str) => err.push(str),
    outputError: (str) => err.push(str),
  });
  // --help and option-validation errors exit through commander's error path:
  // capture the CommanderError instead of letting process.exit kill the worker.
  cmd.exitOverride((error) => {
    throw error;
  });
  const logSpy = captureConsole
    ? vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
        out.push(a.join(" "));
      })
    : null;
  const errorSpy = captureConsole
    ? vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
        err.push(a.join(" "));
      })
    : null;
  const exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation((() => undefined) as any);
  try {
    await cmd.parseAsync(["node", "mafiactl", ...args]);
    // Resolved normally: the action's failure path (process.exit(1)) is
    // captured by the stub above.
    const calls = (exitSpy as any).mock.calls as Array<[number]>;
    const code = calls.length > 0 ? calls[calls.length - 1][0] : 0;
    return { stdout: out.join(""), stderr: err.join(""), code };
  } catch (error: any) {
    // CommanderError from --help / validation: exitCode is the parse exit code.
    const code = typeof error?.exitCode === "number" ? error.exitCode : 1;
    return { stdout: out.join(""), stderr: err.join(""), code };
  } finally {
    logSpy?.mockRestore();
    errorSpy?.mockRestore();
    exitSpy.mockRestore();
  }
}

/**
 * Extract the pretty-printed JSON payload from stdout (the CLI prints a
 * banner and a "Fetching..." line before the JSON body).
 */
function extractJson(stdout: string): Record<string, any> {
  const start = stdout.indexOf("{");
  if (start === -1) {
    throw new Error(`No JSON found in stdout:\n${stdout}`);
  }
  return JSON.parse(stdout.slice(start));
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Pre-test probe: the live-report tests require a reachable mafia server.
 * Skipped with a clear message otherwise (same in-process fetch pattern as
 * apps/server api.test.ts's probeMafiaServer).
 */
async function probeReportEndpoint(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/benchmark/report`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Pre-test probe (MAF-GAP-010 parity): the live-report tests require a
 *  reachable mafia server. In-process fetch (same pattern as apps/server
 *  api.test.ts's probeMafiaServer) — no throwaway node child. Called per
 *  live test as `skipWithoutServer(ctx)`: this package compiles as CommonJS
 *  (no top-level await), so the module-scope `const SERVER_AVAILABLE =
 *  probeReportEndpoint(...)` of the pre-DOC-3 version cannot carry over to
 *  an async probe. */
async function skipWithoutServer(ctx: { skip: () => void }): Promise<boolean> {
  const available = await probeReportEndpoint(TEST_BASE_URL);
  if (!available) {
    console.warn(
      `\n⚠️  Skipping live-server benchmark test: no server reachable at ${TEST_BASE_URL}\n`,
    );
    ctx.skip();
    return true;
  }
  return false;
}

describe("benchmark --help (parse level, in-process)", () => {
  it("lists --server/--json/--export/--games/--models now that runs are wired", async () => {
    const { stdout, stderr, code } = await parseInProcess(
      ["benchmark", "--help"],
      true,
    );

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("--server");
    expect(stdout).toContain("--json");
    expect(stdout).toContain("--export");
    expect(stdout).toContain("--quick");
    // Fresh-run options are now real and advertised (MAF-GAP-015).
    expect(stdout).toContain("--games");
    expect(stdout).toContain("--models");
    // --parallel stays accepted (backward compat) and visible.
    expect(stdout).toContain("--parallel");
    // Run-wait timeout is configurable (DF-MAFIA-AI-BENCHMARK-1: 10-min
    // hardcoded cap killed documented 2-game runs; default now 30 min).
    expect(stdout).toContain("--timeout");
  }, 10000);

  it("rejects a negative --timeout with a clear error", async () => {
    const { stderr, code } = await parseInProcess(
      [
        "benchmark",
        "--games",
        "1",
        "--models",
        "openai/gpt-4o-mini,openai/gpt-4o",
        "--timeout",
        "-5",
        "--server",
        "http://localhost:1",
      ],
      true,
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      "--timeout must be a non-negative number of minutes",
    );
  }, 10000);

  it('does NOT advertise the stale "not yet available" warning in --help', async () => {
    const { stdout } = await parseInProcess(["benchmark", "--help"], true);
    expect(stdout).not.toContain("Fresh benchmark runs are not yet available");
  }, 10000);
});

describe("benchmark report (live server)", () => {
  it("--quick --json prints the REAL report fields, matching a direct fetch", async (ctx) => {
    if (await skipWithoutServer(ctx)) return;
    const cwd = makeTempCwd();
    const { stdout, stderr, code } = await runCli(cwd, [
      "benchmark",
      "--quick",
      "--json",
      "--server",
      TEST_BASE_URL,
    ]);

    expect(stderr).toBe("");
    expect(code).toBe(0);

    const printed = extractJson(stdout);
    expect(typeof printed.summary?.totalGames).toBe("number");
    expect(Array.isArray(printed.modelPerformance)).toBe(true);

    // The printed values must equal the server's real report — not
    // Math.random fabrications (e.g. avgCost in the old invented 1-3 range).
    const response = await fetch(`${TEST_BASE_URL}/api/v1/benchmark/report`, {
      signal: AbortSignal.timeout(30000),
    });
    expect(response.ok).toBe(true);
    const raw = (await response.json()) as Record<string, any>;
    // DF-MAFIA-AI-BENCHMARK-5: the server wraps the report in the standard
    // { success, data } envelope; unwrap for the comparison.
    const serverReport = (
      raw && raw.success === true && raw.data ? raw.data : raw
    ) as Record<string, any>;

    expect(printed.summary.totalGames).toBe(serverReport.summary.totalGames);
    expect(printed.modelPerformance).toEqual(serverReport.modelPerformance);
    expect(printed.recommendations).toEqual(serverReport.recommendations);
  }, 90000);

  it("--export writes the fetched report to the file", async (ctx) => {
    if (await skipWithoutServer(ctx)) return;
    const cwd = makeTempCwd();
    const outPath = path.join(cwd, "report.json");
    const { stdout, stderr, code } = await runCli(cwd, [
      "benchmark",
      "--quick",
      "--export",
      outPath,
      "--server",
      TEST_BASE_URL,
    ]);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("Results exported to");

    expect(existsSync(outPath)).toBe(true);
    const written = JSON.parse(readFileSync(outPath, "utf-8"));
    expect(typeof written.summary?.totalGames).toBe("number");
    expect(Array.isArray(written.modelPerformance)).toBe(true);
  }, 90000);
});

// --- MAF-GAP-062: fresh-game runs cost REAL money and are explicit opt-in ---
//
// The test below POSTs a fresh run and polls it until real LLMs finish playing
// a REAL game against the server (6-10 minutes, real OpenRouter credits). An
// ordinary test-suite run must never trigger it: it only executes when BOTH
// the server is reachable AND the operator explicitly opts in via
// MAFIA_LIVE_BENCHMARK=1.
describe("benchmark fresh game run (live server, opt-in via MAFIA_LIVE_BENCHMARK=1)", () => {
  it(
    "--games 1 --models <pair> POSTs a run, polls progress, and prints the report",
    async (ctx) => {
      if (await skipWithoutServer(ctx)) return;
      if (process.env.MAFIA_LIVE_BENCHMARK !== "1") {
        // MAF-GAP-062: real LLM games cost REAL money — explicit opt-in only.
        ctx.skip();
        return;
      }
      const cwd = makeTempCwd();
      // A real LLM-driven mafia game can take 2-6 minutes end-to-end; allow 12.
      const { stdout, stderr, code } = await runCli(
        cwd,
        [
          "benchmark",
          "--games",
          "1",
          "--models",
          "openai/gpt-4o-mini,openai/gpt-4o",
          "--json",
          "--server",
          TEST_BASE_URL,
        ],
        12 * 60 * 1000,
      );

      expect(stderr).toBe("");
      expect(code).toBe(0);
      // The stale warning is gone.
      expect(stdout).not.toContain(
        "Fresh benchmark runs are not yet available",
      );
      // A runId was returned by the POST and printed.
      expect(stdout).toMatch(/runId[: ]/);
      // A terminal completion line was printed.
      expect(stdout).toMatch(/completed/i);

      // It must still print the real report JSON.
      const printed = extractJson(stdout);
      expect(typeof printed.summary?.totalGames).toBe("number");
      expect(Array.isArray(printed.modelPerformance)).toBe(true);
    },
    12 * 60 * 1000,
  );
});

describe("benchmark (unreachable server)", () => {
  it("exits 1 with a clear connection error", async () => {
    const cwd = makeTempCwd();
    const { stdout, stderr, code } = await runCli(cwd, [
      "benchmark",
      "--quick",
      "--server",
      "http://localhost:59999",
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain("❌ Cannot connect to server");
    expect(stderr).toContain("http://localhost:59999");
    // No fabricated run output.
    expect(stdout).not.toContain("Testing model");
  }, 90000);
});

// --- MAF-GAP-047: pairwise error message + progress heartbeat (mocked fetch, no live server) ---

/** Minimal fetch Response stand-in for mocked endpoints. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERROR",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

type RunBenchmarkOpts = { games?: string; models?: string; json?: boolean };
type RunBenchmarkFn = (
  serverUrl: string,
  opts: RunBenchmarkOpts,
) => Promise<unknown>;

/** Access the private runBenchmark method (unit-test seam; it throws/rejects
 *  instead of catching + process.exit like the public run()). */
function runBenchmarkOf(cmd: BenchmarkCommand): RunBenchmarkFn {
  return (cmd as unknown as { runBenchmark: RunBenchmarkFn }).runBenchmark.bind(
    cmd,
  );
}

/** A status-poll body: RUNNING (or any status) with the given completedGames. */
function statusBody(
  status: string,
  completedGames: number,
): Record<string, unknown> {
  return {
    success: true,
    data: {
      status,
      progress: {
        runId: "run-heartbeat-1",
        status,
        totalGames: 2,
        completedGames,
        validGames: completedGames,
        failedGames: 0,
        pairings: [],
      },
    },
  };
}

const START_BODY = {
  success: true,
  data: {
    runId: "run-heartbeat-1",
    totalGames: 2,
    pairings: [
      {
        id: "p1",
        modelA: "openai/gpt-4o-mini",
        modelB: "openai/gpt-4o",
        games: 1,
      },
    ],
  },
};

const REPORT_BODY = {
  summary: { totalGames: 2, completedGames: 2 },
  modelPerformance: [],
  recommendations: [],
};

describe("benchmark single-model guard (MAF-GAP-047)", () => {
  it("rejects with a pairwise (head-to-head) explanation when only 1 model is given", async () => {
    const cmd = new BenchmarkCommand();
    await expect(
      runBenchmarkOf(cmd)("http://localhost:3004", {
        games: "1",
        models: "openai/gpt-4o-mini",
      }),
    ).rejects.toThrow(/pairwise/);
  }, 10000);
});

describe("benchmark progress heartbeat (MAF-GAP-047)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("prints a heartbeat line while completedGames is stuck at 0, without per-poll spam", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // 1 POST + 9 RUNNING polls (completedGames stuck at 0) + 1 COMPLETED poll + 1 report fetch.
    // Heartbeat interval is 15s; with 2s polls the heartbeat fires on poll 9 (elapsed 18s),
    // BEFORE any completedGames advance.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(START_BODY))
      .mockResolvedValueOnce(jsonResponse(statusBody("RUNNING", 0)))
      .mockResolvedValueOnce(jsonResponse(statusBody("RUNNING", 0)))
      .mockResolvedValueOnce(jsonResponse(statusBody("RUNNING", 0)))
      .mockResolvedValueOnce(jsonResponse(statusBody("RUNNING", 0)))
      .mockResolvedValueOnce(jsonResponse(statusBody("RUNNING", 0)))
      .mockResolvedValueOnce(jsonResponse(statusBody("RUNNING", 0)))
      .mockResolvedValueOnce(jsonResponse(statusBody("RUNNING", 0)))
      .mockResolvedValueOnce(jsonResponse(statusBody("RUNNING", 0)))
      .mockResolvedValueOnce(jsonResponse(statusBody("RUNNING", 0)))
      .mockResolvedValueOnce(jsonResponse(statusBody("COMPLETED", 2)))
      .mockResolvedValueOnce(jsonResponse(REPORT_BODY));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

    const cmd = new BenchmarkCommand();
    const runPromise = runBenchmarkOf(cmd)("http://localhost:3004", {
      games: "1",
      models: "openai/gpt-4o-mini,openai/gpt-4o",
    });

    // Advance fake time in 2s poll steps: 10 polls ≈ 20s, plus slack for the report fetch.
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    await runPromise;

    const printed = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");

    // The heartbeat line appears while completedGames never advanced past 0:
    // poll 9 at elapsed 18s is still RUNNING 0/2.
    expect(printed).toContain("⏳ [RUNNING] 0/2 games completed (elapsed 18s)");
    // Elapsed seconds are included on progress lines.
    expect(printed).toContain("(elapsed ");
    // Exactly 3 progress lines across 10 polls (advance @ poll 1, heartbeat @ poll 9,
    // advance @ poll 10) — NOT one line per poll.
    expect(printed.match(/games completed/g)).toHaveLength(3);
  }, 10000);
});

// --- MAF-GAP-059: report presentation (mocked report, no live server) ---

type DisplayResultsFn = (report: unknown) => void;

/** Access the private displayResults method (unit-test seam, same as runBenchmarkOf). */
function displayResultsOf(cmd: BenchmarkCommand): DisplayResultsFn {
  return (
    cmd as unknown as { displayResults: DisplayResultsFn }
  ).displayResults.bind(cmd);
}

/** Report body mirroring the live server's row shapes (2026-08-25). */
const GAP059_REPORT = {
  summary: { totalGames: 1467 },
  modelPerformance: [
    {
      provider: "openai",
      model: "gpt-4o-mini",
      gamesPlayed: 1198,
      wins: 543,
      winRate: 0.4533,
      avgTokens: 60116,
      avgCost: 0.0118,
    },
    // The unattributable legacy floor: provider CUSTOM, slash-less bare model,
    // wins 0 because usage-only rows carry no side data (MAF-GAP-036/039).
    {
      provider: "CUSTOM",
      model: "openai",
      gamesPlayed: 208,
      wins: 0,
      winRate: 0,
      avgTokens: 810196,
      avgCost: 0.1584,
    },
    {
      provider: "openai",
      model: "gpt-4o",
      gamesPlayed: 54,
      wins: 33,
      winRate: 0.6111,
      avgTokens: 110572,
      avgCost: 0.0059,
    },
  ],
  recommendations: [],
};

describe("benchmark report presentation (MAF-GAP-059)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the unattributable 0-win row with n/a losses, not a defeat count", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    displayResultsOf(new BenchmarkCommand())(GAP059_REPORT);

    const printed = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");

    // The legacy floor row shows n/a in the Losses position…
    expect(printed).toMatch(/CUSTOM\/openai\s+\d+\s+0\s+n\/a/);
    // …and never presents its games as losses.
    expect(printed).not.toContain("206");
    expect(printed).not.toContain("LOSSES");
  });

  it("keeps the real losses count for rows that DO have wins", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    displayResultsOf(new BenchmarkCommand())(GAP059_REPORT);

    const printed = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");

    // gpt-4o-mini: 1198 games - 543 wins = 655 real losses.
    expect(printed).toMatch(/gpt-4o-mini\s+1198\s+543\s+655\b/);
    // gpt-4o: 54 - 33 = 21.
    expect(printed).toMatch(/gpt-4o\s+54\s+33\s+21\b/);
  });

  it("includes the sample size in the winner banner", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    displayResultsOf(new BenchmarkCommand())(GAP059_REPORT);

    const printed = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");

    expect(printed).toContain(
      "🏆 Winner: openai/gpt-4o (61.1% win rate, 54 games)",
    );
  });

  it("renders row names exactly as the API reports provider/model", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    displayResultsOf(new BenchmarkCommand())(GAP059_REPORT);

    const printed = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");

    // The API row is {provider:'openai', model:'gpt-4o-mini'} → openai/gpt-4o-mini.
    expect(printed).toContain("openai/gpt-4o-mini");
    expect(printed).not.toMatch(/CUSTOM\/gpt-4o-mini/);
    // No CLI-invented drift for any row.
    expect(printed).not.toMatch(/CUSTOM\/CUSTOM\//);
  });
});
