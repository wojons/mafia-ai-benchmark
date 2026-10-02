/**
 * Benchmark Command
 *
 * Show the accumulated benchmark report from the server, OR kick off a fresh
 * benchmark run and poll it to completion.
 *
 * - With no run options: fetch and display GET /api/v1/benchmark/report.
 * - With --games/--models: POST /api/v1/benchmark, poll the run status until
 *   terminal, then fetch+display the accumulated report on COMPLETED.
 *
 * MAF-GAP-010/GAP-011 history: this command previously FABRICATED results, then
 * read-only'd itself with a "not yet available" warning while POST was broken.
 * POST is fixed (commit 23aba24), so the CLI now drives real runs (MAF-GAP-015).
 */

import { Command, Option } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import { ExportCommand } from './export.js';
import { resolveServerUrl } from '../config.js';
import { displayName } from '../report-format.js';

/** Default model pair when --games is given without --models. */
const DEFAULT_MODELS = ['openai/gpt-4o-mini', 'openai/gpt-4o'];

/**
 * Split a benchmark model spec ('provider/model' | 'provider:model', the
 * strings benchmark_games.model_a/model_b carry) into the [provider, model]
 * pair displayName() renders — mirror of the server's parseModel ordering
 * (slash wins over colon). Bare model names render as CUSTOM/<model>, the
 * same legacy floor the API rows use.
 */
function splitSpec(spec: string): [string, string] {
  const colonIdx = spec.indexOf(':');
  const slashIdx = spec.indexOf('/');
  if (slashIdx !== -1 && (colonIdx === -1 || slashIdx < colonIdx)) {
    return [spec.slice(0, slashIdx), spec.slice(slashIdx + 1)];
  }
  if (colonIdx !== -1) {
    return [spec.slice(0, colonIdx), spec.slice(colonIdx + 1)];
  }
  return ['CUSTOM', spec];
}

/** Run status values (mirror server BenchmarkRunStatusValue). */
type RunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
const TERMINAL: ReadonlySet<RunStatus> = new Set(['COMPLETED', 'CANCELLED', 'FAILED']);

/** Default max wall-clock time to wait for a run, in ms (30 min). Real
 * LLM-driven 10-player mafia games have been observed to take ~13-14 min
 * each (dogfood 2026-09-01), so a 2-game run needs ~27 min. Override with
 * --timeout <minutes>; 0 waits indefinitely. */
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000;
/** Poll interval, in ms. */
const POLL_INTERVAL_MS = 2000;
/** Print a heartbeat status line when progress is stuck this long, in ms (~15s, 7-8 polls). */
const HEARTBEAT_INTERVAL_MS = 15 * 1000;
/** HTTP timeout for individual API calls, in ms. */
const REQUEST_TIMEOUT_MS = 30000;

interface BenchmarkReport {
  generatedAt?: string;
  summary: {
    totalGames: number;
    activeGames?: number;
    completedGames?: number;
    mafiaWinRate?: number;
    avgDuration?: number;
  };
  modelPerformance: Array<{
    provider: string;
    model: string;
    gamesPlayed: number;
    wins: number;
    losses?: number | null;
    winRate: number;
    avgTokens: number;
    avgCost: number;
    avgLatency?: number;
  }>;
  agentStats?: unknown[];
  recommendations?: string[];
}

/** Run-scoped report (DF-MAFIA-AI-BENCHMARK-28) — GET /api/v1/benchmark/runs/:runId/report. */
interface RunScopedReport {
  runId: string;
  status: RunStatus;
  generatedAt: string;
  summary: {
    totalGames: number;
    completedGames: number;
    validGames: number;
    failedGames: number;
    gamesWithWinner: number;
  };
  modelPerformance: Array<{
    provider: string;
    model: string;
    gamesPlayed: number;
    wins: number;
    losses: number | null;
    winRate: number;
    avgTokens: number;
    avgCost: number;
  }>;
  pairings: Array<{
    id: string;
    modelA: string;
    modelB: string;
    games: number;
    completed: number;
    aWins: number;
    bWins: number;
    unattributed: number;
  }>;
}

interface BenchmarkPairing {
  id: string;
  modelA: string;
  modelB: string;
  games: number;
}

interface StartRunResponse {
  success: boolean;
  data?: {
    runId: string;
    totalGames: number;
    pairings: BenchmarkPairing[];
    message?: string;
  };
  error?: string;
}

interface RunProgress {
  runId: string;
  status: RunStatus;
  totalGames: number;
  completedGames: number;
  validGames: number;
  failedGames: number;
  pairings: Array<{ id: string; modelA: string; modelB: string; games: number; completed: number }>;
}

interface RunStatusResponse {
  success: boolean;
  data?: {
    status: RunStatus;
    progress: RunProgress;
  };
  error?: string;
}

export class BenchmarkCommand extends Command {
  constructor() {
    super('benchmark');
    this.description('Show the accumulated benchmark report, or run a fresh benchmark');

    this.option('--quick', 'Show the accumulated benchmark report (default behavior)', false);
    this.option('--export <path>', 'Export results to file');
    this.option('--json', 'Output results as JSON');
    this.option('--server <url>', 'Server base URL (default: http://localhost:3004)');
    this.option('--timeout <minutes>', 'Max minutes to wait for a fresh run (default: 30; 0 = wait indefinitely)');

    // Fresh-run options: POST a benchmark run and poll it to completion.
    this.addOption(new Option('-g, --games <n>', 'Run N fresh benchmark games (requires server POST /api/v1/benchmark)'));
    this.addOption(new Option('--models <models>', 'Comma-separated models to benchmark (default: openai/gpt-4o-mini,openai/gpt-4o)'));
    this.addOption(new Option('--parallel', 'Accepted for backward compatibility (server runs games asynchronously); ignored'));

    // Add export subcommand
    this.addCommand(new ExportCommand());

    this.action(async () => { await this.run(); });
  }

  async run(): Promise<void> {
    const { export: exportPath, json, server, games, models, parallel, timeout } = this.opts();

    const serverUrl = resolveServerUrl(server);

    console.log(chalk.cyan('\n🏁 Mafia AI Benchmark Suite\n'));

    // A run is requested when either --games or --models is supplied.
    const wantsRun = games !== undefined || models !== undefined;

    if (parallel !== undefined) {
      console.log(chalk.gray('ℹ️  --parallel is accepted for backward compatibility; the server runs games asynchronously, so it is ignored.'));
      console.log('');
    }

    try {
      let report: BenchmarkReport;

      if (wantsRun) {
        report = await this.runBenchmark(serverUrl, { games, models, json, timeout });
      } else {
        report = await this.fetchReport(serverUrl);
      }

      if (json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        this.displayResults(report);
      }

      // Export results if requested
      if (exportPath) {
        this.exportResults(report, exportPath);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch')) {
        console.error(chalk.red(`\n❌ Cannot connect to server at ${serverUrl}`));
        console.error(chalk.gray('   Make sure the server is running: pnpm run dev --filter=@mafia/server'));
      } else {
        console.error(chalk.red(`\n❌ ${error.message}`));
      }
      process.exit(1);
    }
  }

  /**
   * POST a fresh benchmark run and poll it to completion. Returns the
   * accumulated server report (the run's results are folded into it).
   */
  private async runBenchmark(
    serverUrl: string,
    opts: { games?: string; models?: string; json?: boolean; timeout?: string },
  ): Promise<BenchmarkReport> {
    const modelList = opts.models
      ? opts.models.split(',').map((m) => m.trim()).filter(Boolean)
      : [...DEFAULT_MODELS];

    if (modelList.length < 2) {
      throw new Error(`Benchmark requires at least 2 models, got ${modelList.length}. Benchmarks compare models pairwise (head-to-head), so at least 2 models are required. Use --models provider/model,provider/model (e.g. --models openai/gpt-4o-mini,openai/gpt-4o).`);
    }

    const gamesPerPairing = opts.games !== undefined
      ? this.parseGames(opts.games)
      : 2;

    // Validate the wait timeout up front (before any server call) so a bad
    // --timeout fails fast with a clear message (DF-MAFIA-AI-BENCHMARK-1).
    const runTimeoutMs = this.resolveRunTimeoutMs(opts.timeout);

    const config = {
      models: modelList,
      gamesPerPairing,
    };

    console.log(chalk.cyan(`▶️  Starting benchmark: ${gamesPerPairing} game(s) per pairing across ${modelList.length} model(s)`));
    console.log(chalk.gray(`   models: ${modelList.join(', ')}`));
    console.log('');

    // POST the run.
    const startUrl = `${serverUrl}/api/v1/benchmark`;
    console.log(chalk.gray(`📡 POST ${startUrl} ...`));

    const startResp = await fetch(startUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ config }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!startResp.ok) {
      const errorText = await startResp.text().catch(() => '');
      throw new Error(`Failed to start benchmark (HTTP ${startResp.status}): ${errorText || startResp.statusText}`);
    }

    const startBody = await startResp.json() as StartRunResponse;
    if (!startBody.success || !startBody.data) {
      throw new Error(`Server refused benchmark start: ${startBody.error ?? 'unknown error'}`);
    }

    const { runId, totalGames, pairings } = startBody.data;
    console.log(chalk.green(`✅ Run started — runId: ${chalk.yellow(runId)} (${totalGames} game(s), ${pairings.length} pairing(s))`));
    console.log('');

    // Poll the run status.
    const statusUrl = `${serverUrl}/api/v1/benchmark/runs/${runId}`;
    const deadline = runTimeoutMs === 0 ? Infinity : Date.now() + runTimeoutMs;
    const runStartedAt = Date.now();
    let lastCompleted = -1;
    let lastHeartbeatAt = 0;
    let progress: RunProgress | null = null;

    while (Date.now() < deadline) {
      await this.sleep(POLL_INTERVAL_MS);

      const resp = await fetch(statusUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (resp.status === 404) {
        throw new Error(`Benchmark run ${runId} disappeared (404) while polling.`);
      }
      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '');
        throw new Error(`Failed to poll run status (HTTP ${resp.status}): ${errorText || resp.statusText}`);
      }

      const body = await resp.json() as RunStatusResponse;
      if (!body.success || !body.data) {
        throw new Error(`Malformed run status response: ${JSON.stringify(body)}`);
      }

      progress = body.data.progress;

      // Print progress when the completed count advances, AND send a heartbeat
      // when it has been stuck (a single long game can keep completedGames at 0
      // for minutes) — MAF-GAP-047. Never print on every poll (2s spam).
      const elapsedMs = Date.now() - runStartedAt;
      if (progress.completedGames !== lastCompleted || elapsedMs - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        lastCompleted = progress.completedGames;
        lastHeartbeatAt = elapsedMs;
        console.log(chalk.gray(this.formatProgressLine(progress, elapsedMs)));
      }

      if (TERMINAL.has(progress.status)) {
        break;
      }
    }

    if (!progress) {
      throw new Error(`No status received for benchmark run ${runId}.`);
    }

    if (!TERMINAL.has(progress.status)) {
      const timeoutLabel = runTimeoutMs === 0 ? 'unlimited' : `${Math.round(runTimeoutMs / 1000)}s`;
      throw new Error(`Benchmark run ${runId} did not finish within ${timeoutLabel} (last status: ${progress.status}). The server may still be processing it; check 'mafiactl benchmark --json' later, or re-run with a larger --timeout.`);
    }

    console.log('');

    if (progress.status === 'COMPLETED') {
      console.log(chalk.green(`🎉 Benchmark run ${runId} completed — ${progress.completedGames}/${progress.totalGames} games (${progress.validGames} valid, ${progress.failedGames} failed).`));
      console.log('');
      // DF-MAFIA-AI-BENCHMARK-28: the verdict must be about THIS run.
      // The accumulated report (GET /api/v1/benchmark/report) mixes every
      // run ever recorded (and legacy polluted rows, DF-25), so the
      // 'Winner' banner used to quote 88 lifetime games for a 2-game run.
      // The run-scoped report (GET /api/v1/benchmark/runs/:id/report)
      // derives the winner from this run's own benchmark_games +
      // players rows. The accumulated report is used ONLY when this
      // server predates the run-scoped endpoint (404) — never silently
      // as the primary source.
      console.log(chalk.gray('   Fetching run-scoped report ...'));
      try {
        const runReport = await this.fetchRunReport(serverUrl, runId);
        console.log('');
        return { ...runReport, runScoped: true } as unknown as BenchmarkReport;
      } catch (error: unknown) {
        const err = error as { message?: string };
        // Only a 404 (server without the run-scoped endpoint) falls back
        // to the accumulated report — and it must say so loudly.
        if (err?.message?.includes('404')) {
          console.log(chalk.yellow('   ⚠️  Run-scoped report unavailable (server predates DF-28)'));
          console.log(chalk.yellow('   ⚠️  Falling back to the ACCUMULATED report — its verdict covers ALL runs, not just this one.'));
          console.log(chalk.gray('   Fetching accumulated report ...'));
          console.log('');
          return await this.fetchReport(serverUrl);
        }
        throw error;
      }
    }

    // FAILED or CANCELLED
    if (progress.status === 'FAILED') {
      throw new Error(`Benchmark run ${runId} FAILED (${progress.failedGames}/${progress.totalGames} games failed). See server logs for details.`);
    }
    // CANCELLED
    throw new Error(`Benchmark run ${runId} was CANCELLED.`);
  }

  private parseGames(raw: string): number {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`--games must be a positive integer, got "${raw}".`);
    }
    return n;
  }

  /** Resolve the run wait timeout from --timeout <minutes> (default 30; 0 = wait indefinitely). */
  private resolveRunTimeoutMs(raw?: string): number {
    if (raw === undefined) {
      return DEFAULT_RUN_TIMEOUT_MS;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`--timeout must be a non-negative number of minutes, got "${raw}".`);
    }
    return Math.round(n * 60 * 1000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Format one progress/heartbeat status line (MAF-GAP-047). */
  private formatProgressLine(progress: RunProgress, elapsedMs: number): string {
    const elapsedSec = Math.round(elapsedMs / 1000);
    return `⏳ [${progress.status}] ${progress.completedGames}/${progress.totalGames} games completed` +
      (progress.failedGames > 0 ? `, ${progress.failedGames} failed` : '') +
      ` (elapsed ${elapsedSec}s)`;
  }

  /**
   * Fetch the RUN-SCOPED report for one benchmark run
   * (GET /api/v1/benchmark/runs/:runId/report — DF-MAFIA-AI-BENCHMARK-28).
   * Throws on any non-OK response (the 404 case is handled by the caller's
   * fallback to the accumulated report).
   */
  private async fetchRunReport(serverUrl: string, runId: string): Promise<RunScopedReport> {
    const url = `${serverUrl}/api/v1/benchmark/runs/${runId}/report`;

    console.log(chalk.gray(`📡 Fetching run-scoped report from ${url}...`));

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Server returned ${response.status}: ${errorText || response.statusText}`);
    }

    const body = (await response.json()) as
      | { success: true; data: RunScopedReport }
      | { success: false; error?: string };

    if ('success' in body && body.success === true && 'data' in body && body.data) {
      return body.data;
    }
    throw new Error(`Server refused run report: ${('error' in body && body.error) || 'unknown error'}`);
  }

  private async fetchReport(serverUrl: string): Promise<BenchmarkReport> {
    const url = `${serverUrl}/api/v1/benchmark/report`;

    console.log(chalk.gray(`📡 Fetching benchmark report from ${url}...`));

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    const body = (await response.json()) as
      | { success: true; data: BenchmarkReport }
      | { success: false; error?: string };

    // DF-MAFIA-AI-BENCHMARK-5: the server now wraps the report in the
    // standard { success, data } envelope. Unwrap it; a bare top-level
    // report (older server) still works.
    if (
      'success' in body &&
      body.success === true &&
      'data' in body &&
      body.data &&
      typeof body.data === 'object'
    ) {
      return body.data;
    }
    if ('success' in body && body.success === false) {
      throw new Error(`Server refused report: ${body.error ?? 'unknown error'}`);
    }

    return body as unknown as BenchmarkReport;
  }

  private displayResults(report: BenchmarkReport): void {
    const summary = report.summary || { totalGames: 0 };
    const results = report.modelPerformance || [];
    const recommendations = (report as unknown as { recommendations?: string[] }).recommendations || [];
    // DF-MAFIA-AI-BENCHMARK-28: a run-scoped report announces itself and
    // prints the per-pairing results — the verdict is about THIS run.
    const runScoped = (report as unknown as { runScoped?: boolean; pairings?: Array<{ id: string; modelA: string; modelB: string; games: number; completed: number; aWins: number; bWins: number; unattributed: number }> }).runScoped === true;
    const pairings = (report as unknown as { pairings?: Array<{ id: string; modelA: string; modelB: string; games: number; completed: number; aWins: number; bWins: number; unattributed: number }> }).pairings || [];

    console.log(chalk.green(runScoped ? '\n✅ Benchmark Report (this run)\n' : '\n✅ Benchmark Report\n'));

    console.log(chalk.white('Summary:'));
    console.log(`  Total Games:      ${chalk.yellow((summary.totalGames ?? 0).toString())}`);
    if (summary.completedGames !== undefined) {
      console.log(`  Completed Games:  ${chalk.yellow(summary.completedGames.toString())}`);
    }
    if (summary.activeGames !== undefined) {
      console.log(`  Active Games:     ${chalk.yellow(summary.activeGames.toString())}`);
    }
    const avgDuration = summary.avgDuration ?? 0;
    if (avgDuration > 0) {
      // The report's avgDuration is in SECONDS (MAF-GAP-026); formatDuration takes ms.
      console.log(`  Avg Time/Game:    ${chalk.yellow(this.formatDuration(avgDuration * 1000))}`);
    } else {
      console.log(`  Avg Time/Game:    ${chalk.gray('n/a')}`);
    }

    console.log(chalk.white('\n📊 Results by Model:'));
    console.log(chalk.gray('  Model                  Games  Wins  Losses  Win Rate  Avg Tokens  Avg Cost'));
    console.log(chalk.gray('  ' + '─'.repeat(75)));

    results.forEach(r => {
      // MAF-GAP-059: render exactly the provider/model the API row reports —
      // no CLI-side prefixing or rewriting. (The 'CUSTOM/<bare-model>' legacy
      // floor is injected server-side; see report-format.ts.)
      const model = displayName(r.provider, r.model).padEnd(20);
      const gamesPlayed = (r.gamesPlayed ?? 0);
      const wins = (r.wins ?? 0);
      const games = gamesPlayed.toString().padStart(5);
      const winsStr = wins.toString().padStart(5);
      // MAF-GAP-059: a 0-win row has no side data (documented honest floor,
      // MAF-GAP-036/039) — its games are unattributable, not defeats.
      // Real win counts are kept for rows that DO have wins.
      // DF-MAFIA-AI-BENCHMARK-28: run-scoped rows carry an EXPLICIT losses
      // column from the server (null = unattributable run) — prefer it;
      // the derived games-wins shape stays for accumulated rows.
      const reportedLosses = r.losses;
      const losses = (typeof reportedLosses === 'number')
        ? (reportedLosses as number).toString().padStart(6)
        : (reportedLosses === null || wins === 0)
          ? 'n/a'.padStart(6)
          : (gamesPlayed - wins).toString().padStart(6);
      const winRate = ((r.winRate ?? 0) * 100).toFixed(1).padStart(8) + '%';
      const tokens = ((r.avgTokens ?? 0) / 1000).toFixed(1).padStart(10) + 'K';
      const cost = '$' + (r.avgCost ?? 0).toFixed(2).padStart(7);

      console.log(`  ${model} ${games}  ${winsStr}  ${losses}  ${winRate}  ${tokens}  ${cost}`);
    });

    // DF-MAFIA-AI-BENCHMARK-28: run-scoped reports print the per-pairing
    // head-to-head results (which model of the pair won each game).
    if (runScoped && pairings.length > 0) {
      console.log(chalk.white('\n⚔️  Head-to-Head (this run):'));
      for (const p of pairings) {
        const parts: string[] = [];
        if (p.aWins > 0) parts.push(`${displayName(...splitSpec(p.modelA))}: ${p.aWins}`);
        if (p.bWins > 0) parts.push(`${displayName(...splitSpec(p.modelB))}: ${p.bWins}`);
        const verdict = parts.length > 0 ? parts.join(', ') : 'no decided games';
        const notes: string[] = [];
        if (p.unattributed > 0) notes.push(`${p.unattributed} unattributed`);
        console.log(`  ${p.id} — ${p.completed}/${p.games} completed — ${verdict}` +
          (notes.length > 0 ? chalk.gray(` (${notes.join(', ')})`) : ''));
      }
      console.log('');
    }

    if (results.length > 0) {
      // MAF-GAP-059: sample size is part of the headline — a 54-game win rate
      // must be readable as such next to a 1000+-game rival.
      // DF-MAFIA-AI-BENCHMARK-28: a model with ZERO wins cannot be the
      // winner even when every other row also has zero wins — the
      // reduce-below would crown the FIRST row of an all-zero table. Pick
      // the highest win rate among rows that actually won something; with
      // no decided games at all, say so instead of naming a winner.
      const winners = results.filter((m) => (m.wins ?? 0) > 0);
      if (winners.length > 0) {
        const winner = winners.reduce(
          (best, m) => (m.winRate ?? 0) > (best.winRate ?? 0) ? m : best,
          winners[0],
        );
        console.log(chalk.green('\n🏆 Winner: ') + chalk.yellow(displayName(winner.provider, winner.model)) +
                    chalk.gray(` (${((winner.winRate ?? 0) * 100).toFixed(1)}% win rate, ${(winner.gamesPlayed ?? 0)} games)\n`));
      } else {
        console.log(chalk.yellow('\n🏆 Winner: none — no game in this run had a decided, attributable outcome.\n'));
      }
    }

    // Recommendations come from the server report
    if (recommendations.length > 0) {
      console.log(chalk.white('💡 Recommendations:'));
      recommendations.forEach(r => {
        console.log(`  • ${r}`);
      });
      console.log('');
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  private exportResults(report: BenchmarkReport, exportPath: string): void {
    fs.writeFileSync(exportPath, JSON.stringify(report, null, 2));
    console.log(chalk.green(`\n📁 Results exported to: ${exportPath}\n`));
  }
}

export default BenchmarkCommand;
