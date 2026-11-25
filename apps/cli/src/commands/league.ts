/**
 * League Command (MAF-LAYER-3)
 *
 * Scheduled mixed-model league play against the server's LeagueRunner:
 *
 * - `mafiactl league start --models a,b --budget 1.00 [--games N] [--poll]`
 *   POSTs /api/v1/league, reports the run id; with --poll it polls
 *   GET /api/v1/league/:id until a terminal status and prints the summary.
 * - `mafiactl league status <leagueId>` fetches and prints the run's
 *   status, spend/cap state, and per-game provenance (seat map + outcome).
 *
 * The league itself is capped server-side (BUDGET_CAPPED is a terminal
 * status, not an error); the CLI reports it as such.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolveServerUrl } from '../config.js';

/** Default round count when --games is not given (mirrors the server default). */
const DEFAULT_GAMES = 2;
/** Default max wall-clock time to wait with --poll, in ms (30 min). */
const DEFAULT_POLL_TIMEOUT_MS = 30 * 60 * 1000;
/** Poll interval, in ms. */
const POLL_INTERVAL_MS = 2000;
/** HTTP timeout for individual API calls, in ms. */
const REQUEST_TIMEOUT_MS = 30000;

type LeagueStatusValue =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'BUDGET_CAPPED';

const TERMINAL: ReadonlySet<LeagueStatusValue> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BUDGET_CAPPED',
]);

interface StartLeagueResponse {
  success: boolean;
  data?: {
    leagueId: string;
    games: number;
    models: string[];
    seatGroups: string[];
    message?: string;
  };
  error?: string;
}

interface LeagueGameRecord {
  gameId: string;
  round: number;
  seatMap: Record<string, string>;
  seatSeed: number;
  winner: string | null;
  completedAt: number | null;
  error: string | null;
  costUsd: number | null;
  totalTokens: number | null;
}

interface LeagueDetail {
  status: {
    leagueId: string;
    status: LeagueStatusValue;
    config: {
      models: string[];
      numPlayers: number;
      games: number;
      budgetUsd: number;
      seatSeed: number;
    };
    createdAt: number;
    completedAt: number | null;
    summary: Record<string, unknown> | null;
    error: string | null;
    totalGames: number;
  };
  games: LeagueGameRecord[];
  spend: {
    spentUsd: number;
    budgetUsd: number;
    remainingUsd: number;
    capped: boolean;
  };
}

type LeagueDetailResponse =
  | { success: true; data: LeagueDetail }
  | { success: false; error?: string };

/** Print one league detail record (status, spend/cap, per-game provenance). */
function displayLeagueDetail(detail: LeagueDetail): void {
  const { status, spend } = detail;
  console.log('');
  console.log(chalk.green(`🏆 League ${status.leagueId} — ${status.status}`));

  console.log(chalk.white('\nSpend:'));
  console.log(`  Spent:      ${chalk.yellow(`$${spend.spentUsd.toFixed(6)}`)}`);
  console.log(`  Budget cap: ${chalk.yellow(`$${spend.budgetUsd.toFixed(2)}`)}`);
  console.log(`  Remaining:  ${chalk.yellow(`$${spend.remainingUsd.toFixed(6)}`)}`);
  if (spend.capped) {
    console.log(chalk.yellow('  ⛔ Budget cap reached — no further games will start.'));
  }
  if (status.error) {
    console.log(chalk.red(`  Error: ${status.error}`));
  }

  console.log(chalk.white('\nGames:'));
  for (const game of detail.games) {
    const seatPairs = Object.entries(game.seatMap)
      .map(([role, model]) => `${role}=${model}`)
      .join(', ');
    const outcome = game.error
      ? chalk.red(`error: ${game.error}`)
      : game.completedAt !== null
        ? chalk.green(`winner: ${game.winner ?? 'none'}`)
        : chalk.gray('in flight');
    const cost = game.costUsd === null ? chalk.gray('n/a') : `$${game.costUsd.toFixed(6)}`;
    console.log(`  Round ${game.round} — ${outcome}`);
    console.log(chalk.gray(`    game ${game.gameId} — cost ${cost} — seats: ${seatPairs}`));
  }
  console.log('');
}

export class LeagueStartCommand extends Command {
  constructor() {
    super('start');
    this.description('Start a scheduled mixed-model league run (budget-capped)');

    this.option('--models <models>', 'Comma-separated model specs (provider/model), at least 2');
    this.option('--budget <usd>', 'Hard spend cap in USD (required)',);
    this.option('--games <n>', 'Number of league games/rounds (default: 2)');
    this.option('--num-players <n>', 'Players per game, 5-50 (default: 10)');
    this.option('--seat-seed <n>', 'Shuffle seed for reproducible seat maps');
    this.option('--poll', 'Poll the run to its terminal status after starting');
    this.option('--timeout <minutes>', 'Max minutes to wait with --poll (default: 30; 0 = forever)');
    this.option('--json', 'Output as JSON');
    this.option('--server <url>', 'Server base URL (default: http://localhost:3004)');

    this.action(async () => { await this.run(); });
  }

  async run(): Promise<void> {
    const opts = this.opts() as {
      models?: string;
      budget?: string;
      games?: string;
      numPlayers?: string;
      seatSeed?: string;
      poll?: boolean;
      timeout?: string;
      json?: boolean;
      server?: string;
    };

    const serverUrl = resolveServerUrl(opts.server);

    const models = (opts.models ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    if (models.length < 2) {
      console.error(chalk.red('❌ --models needs at least 2 comma-separated model specs (provider/model).'));
      process.exit(1);
    }
    const budgetUsd = Number(opts.budget);
    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
      console.error(chalk.red(`❌ --budget must be a positive USD amount, got "${opts.budget ?? ''}".`));
      process.exit(1);
    }

    const config: Record<string, unknown> = {
      models,
      budgetUsd,
      games: opts.games !== undefined ? Number(opts.games) : DEFAULT_GAMES,
    };
    if (opts.numPlayers !== undefined) config.numPlayers = Number(opts.numPlayers);
    if (opts.seatSeed !== undefined) config.seatSeed = Number(opts.seatSeed);

    try {
      console.log(chalk.cyan('\n🏆 Mafia League (mixed-model, budget-capped)\n'));
      const startUrl = `${serverUrl}/api/v1/league`;
      console.log(chalk.gray(`📡 POST ${startUrl} ...`));

      const startResp = await fetch(startUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ config }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const startBody = (await startResp.json().catch(() => null)) as StartLeagueResponse | null;
      if (!startResp.ok || !startBody?.success || !startBody.data) {
        const detail = startBody?.error ?? startResp.statusText;
        console.error(chalk.red(`❌ Failed to start league (HTTP ${startResp.status}): ${detail}`));
        process.exit(1);
      }

      const { leagueId, games } = startBody.data;
      console.log(chalk.green(`✅ League started — leagueId: ${chalk.yellow(leagueId)} (${games} game(s) scheduled)`));
      console.log(chalk.gray(`   models: ${models.join(', ')}`));
      console.log(chalk.gray(`   budget: $${budgetUsd.toFixed(2)} (hard cap)`));

      if (opts.json) {
        console.log(JSON.stringify(startBody.data, null, 2));
      }

      if (opts.poll) {
        const timeoutMs = this.resolvePollTimeoutMs(opts.timeout);
        const detail = await this.pollToTerminal(serverUrl, leagueId, timeoutMs);
        if (opts.json) {
          console.log(JSON.stringify(detail, null, 2));
        } else {
          displayLeagueDetail(detail);
        }
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

  private resolvePollTimeoutMs(raw?: string): number {
    if (raw === undefined) return DEFAULT_POLL_TIMEOUT_MS;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`--timeout must be a non-negative number of minutes, got "${raw}".`);
    }
    return Math.round(n * 60 * 1000);
  }

  /** Poll GET /api/v1/league/:id until a terminal status (or throw). */
  private async pollToTerminal(serverUrl: string, leagueId: string, timeoutMs: number): Promise<LeagueDetail> {
    const url = `${serverUrl}/api/v1/league/${leagueId}`;
    const deadline = timeoutMs === 0 ? Infinity : Date.now() + timeoutMs;
    let lastCompleted = -1;
    let detail: LeagueDetail;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (resp.status === 404) {
        throw new Error(`League run ${leagueId} disappeared (404) while polling.`);
      }
      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '');
        throw new Error(`Failed to poll league status (HTTP ${resp.status}): ${errorText || resp.statusText}`);
      }
      const body = (await resp.json()) as LeagueDetailResponse;
      if (!body.success || !body.data) {
        throw new Error(`Malformed league status response: ${JSON.stringify(body)}`);
      }
      detail = body.data;

      const completed = detail.games.filter((g) => g.completedAt !== null || g.error !== null).length;
      if (completed !== lastCompleted) {
        lastCompleted = completed;
        const spendLine = `$${detail.spend.spentUsd.toFixed(4)} / $${detail.spend.budgetUsd.toFixed(2)}`;
        console.log(chalk.gray(`⏳ [${detail.status.status}] ${completed}/${detail.status.totalGames} games settled — spend ${spendLine}`));
      }
      if (TERMINAL.has(detail.status.status)) {
        return detail;
      }
    }

    throw new Error(
      `League run ${leagueId} did not finish within the wait budget. Check 'mafiactl league status ${leagueId}' later.`,
    );
  }
}

export class LeagueStatusCommand extends Command {
  constructor() {
    super('status');
    this.description('Show one league run: status, spend/cap state, per-game provenance');
    this.argument('<leagueId>', 'League run id');
    this.option('--json', 'Output as JSON');
    this.option('--server <url>', 'Server base URL (default: http://localhost:3004)');

    this.action(async (leagueId: string) => { await this.run(leagueId); });
  }

  async run(leagueId: string): Promise<void> {
    const opts = this.opts() as { json?: boolean; server?: string };
    const serverUrl = resolveServerUrl(opts.server);

    try {
      const url = `${serverUrl}/api/v1/league/${encodeURIComponent(leagueId)}`;
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (resp.status === 404) {
        console.error(chalk.red(`❌ League run ${leagueId} not found.`));
        process.exit(1);
      }
      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '');
        console.error(chalk.red(`❌ Failed to fetch league status (HTTP ${resp.status}): ${errorText || resp.statusText}`));
        process.exit(1);
      }
      const body = (await resp.json()) as LeagueDetailResponse;
      if (!body.success || !body.data) {
        console.error(chalk.red(`❌ Malformed league status response.`));
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(body.data, null, 2));
      } else {
        displayLeagueDetail(body.data);
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
}

export class LeagueCommand extends Command {
  constructor() {
    super('league');
    this.description('Scheduled mixed-model league play (MAF-LAYER-3)');

    this.addCommand(new LeagueStartCommand());
    this.addCommand(new LeagueStatusCommand());

    this.action(() => {
      this.help();
    });
  }
}

export default LeagueCommand;
