/**
 * Runs Command — per-run JSONL run-record corpus (MAF-LAYER-1).
 *
 * - `mafiactl runs export <gameId>` writes data/runs/<gameId>.jsonl (run
 *   header line 1, then one event line per event in game order) and appends
 *   exactly one index line to data/runs/index.jsonl.
 * - `mafiactl runs backfill` exports every ENDED game the server reports.
 *
 * Both paths are idempotent: re-export rewrites the run file only when its
 * deterministic serialization differs (compare-then-skip) and never
 * duplicates an index line. Fetch paths reuse the existing game REST
 * endpoints only — no new server surface.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { resolveServerUrl } from '../config.js';
import type {
  ApiEvent,
  ApiGameDetail,
} from '../runs-format.js';
import {
  buildIndexEntry,
  buildRunRecord,
  serializeIndexLine,
  serializeRunFile,
} from '../runs-format.js';

/** HTTP timeout for individual API calls, in ms (matches sibling commands). */
const REQUEST_TIMEOUT_MS = 30000;
/** Page size when listing games for backfill. */
const BACKFILL_PAGE_SIZE = 100;

/**
 * Data dir resolution: --data-dir > MAFIA_RUNS_DIR > 'data/runs' (relative to
 * the current working directory, so running mafiactl from the repo root
 * lands in the repo's data/runs — .gitignore'd, never committed).
 */
function resolveDataDir(cliDataDir?: string): string {
  return cliDataDir || process.env.MAFIA_RUNS_DIR || 'data/runs';
}

export class RunsCommand extends Command {
  constructor() {
    super('runs');
    this.description('Per-run JSONL run-record corpus (export, backfill)');

    this.addCommand(new RunsExportCommand());
    this.addCommand(new RunsBackfillCommand());

    this.action(() => {
      this.help();
    });
  }
}

export class RunsExportCommand extends Command {
  constructor() {
    super('export');
    this.description(
      'Export one ENDED game as a JSONL run file plus an index line',
    );
    this.argument('<gameId>', 'Game id to export (as shown by list-games)');
    this.option('--data-dir <dir>', 'Runs output directory (default: data/runs)');
    this.option('--server <url>', 'Server base URL (default: http://localhost:3004)');

    this.action(async (gameId: string) => { await this.run(gameId); });
  }

  async run(gameId: string): Promise<void> {
    const { dataDir, server } = this.opts();
    const serverUrl = resolveServerUrl(server);
    const runsDir = resolveDataDir(dataDir);

    try {
      const outcome = await exportGame(serverUrl, runsDir, gameId);
      const fileDesc = path.join(runsDir, outcome.fileName);
      if (outcome.fileChanged) {
        console.log(chalk.green(`✅ Run file written: ${fileDesc} (${outcome.eventCount} events)`));
      } else {
        console.log(chalk.gray(`✓ Run file unchanged (already exported): ${fileDesc} (${outcome.eventCount} events)`));
      }
      if (outcome.indexChanged) {
        console.log(chalk.green(`✅ Index line appended: ${fileDesc}`));
      } else {
        console.log(chalk.gray('✓ Index already contains this game (no duplicate added)'));
      }
    } catch (error) {
      reportFetchError(error, serverUrl, gameId);
      process.exit(1);
    }
  }
}

export class RunsBackfillCommand extends Command {
  constructor() {
    super('backfill');
    this.description('Export every ENDED game the server reports as run files');
    this.option('--data-dir <dir>', 'Runs output directory (default: data/runs)');
    this.option('--server <url>', 'Server base URL (default: http://localhost:3004)');

    this.action(async () => { await this.run(); });
  }

  async run(): Promise<void> {
    const { dataDir, server } = this.opts();
    const serverUrl = resolveServerUrl(server);
    const runsDir = resolveDataDir(dataDir);

    try {
      const gameIds = await listEndedGameIds(serverUrl);

      let exported = 0;
      let skipped = 0;
      for (const gameId of gameIds) {
        const outcome = await exportGame(serverUrl, runsDir, gameId);
        if (outcome.fileChanged || outcome.indexChanged) {
          exported += 1;
        } else {
          skipped += 1;
        }
      }

      console.log('');
      console.log(
        chalk.green(`✅ Backfill complete — ${gameIds.length} ENDED game(s) on server, ` +
          `${exported} newly written, ${skipped} already up to date.`),
      );
    } catch (error) {
      reportFetchError(error, serverUrl, 'backfill');
      process.exit(1);
    }
  }
}

/**
 * Export one game: fetch detail + replay, write the run file when its
 * deterministic serialization differs, append the index line once. Pure
 * shaping lives in runs-format.ts; this orchestrates fetches + idempotent
 * file state.
 */
export async function exportGame(
  serverUrl: string,
  runsDir: string,
  gameId: string,
): Promise<{ fileChanged: boolean; indexChanged: boolean; eventCount: number; fileName: string }> {
  const game = await fetchGameDetail(serverUrl, gameId);
  if (game.status && game.status !== 'ENDED') {
    throw new Error(`Game ${gameId} is ${game.status}, not ENDED — refusing to export a non-terminal game.`);
  }

  const events = await fetchGameEvents(serverUrl, gameId);
  const record = buildRunRecord(game);
  const fileBody = serializeRunFile(record, events);

  fs.mkdirSync(runsDir, { recursive: true });
  const fileName = `${gameId}.jsonl`;
  const filePath = path.join(runsDir, fileName);

  // Idempotent: the serialization is deterministic, so identical content
  // means the same game state — keep the file bytes untouched.
  const fileChanged =
    !fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf-8') !== fileBody;
  if (fileChanged) {
    fs.writeFileSync(filePath, fileBody, 'utf-8');
  }

  // Index: exactly one line per game, ever. Re-running must not append.
  const indexPath = path.join(runsDir, 'index.jsonl');
  const indexLine = serializeIndexLine(
    buildIndexEntry(record, fileName),
  );
  let indexChanged = false;
  const existing = fs.existsSync(indexPath)
    ? fs.readFileSync(indexPath, 'utf-8').split('\n').filter((l) => l.trim() !== '')
    : [];
  const alreadyIndexed = existing.some((line) => {
    try {
      return (JSON.parse(line) as { game_id?: string }).game_id === gameId;
    } catch {
      return false; // a torn line never blocks a fresh export
    }
  });
  if (!alreadyIndexed) {
    fs.appendFileSync(indexPath, indexLine, 'utf-8');
    indexChanged = true;
  }

  return { fileChanged, indexChanged, eventCount: events.length, fileName };
}

async function fetchGameDetail(serverUrl: string, gameId: string): Promise<ApiGameDetail> {
  const url = `${serverUrl}/api/v1/games/${gameId}`;
  const body = await fetchJson(url, gameId);
  return body.data as unknown as ApiGameDetail;
}

async function fetchGameEvents(serverUrl: string, gameId: string): Promise<ApiEvent[]> {
  // The replay endpoint ({ success, data: GameEvent[], count }) returns the
  // full event timeline sorted chronologically; orderEvents re-derives the
  // order anyway so the corpus never depends on the server's sort.
  const url = `${serverUrl}/api/v1/games/${gameId}/replay`;
  const body = await fetchJson(url, gameId);
  if (!Array.isArray(body.data)) {
    throw new Error(`Replay response for game ${gameId} has no event array.`);
  }
  return body.data as ApiEvent[];
}

async function listEndedGameIds(serverUrl: string): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  let offset = 0;
  while (true) {
    const url = `${serverUrl}/api/v1/games?status=ENDED&limit=${BACKFILL_PAGE_SIZE}&offset=${offset}`;
    const body = await fetchJson(url, 'backfill');
    const games = Array.isArray(body.data) ? body.data : [];
    for (const g of games) {
      const id = (g as { id?: string }).id;
      if (typeof id === 'string' && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    if (games.length < BACKFILL_PAGE_SIZE) {
      break;
    }
    offset += BACKFILL_PAGE_SIZE;
  }
  return ids;
}

interface Envelope {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  success?: boolean;
  error?: string;
}

async function fetchJson(url: string, gameId: string): Promise<Envelope> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) {
    throw new Error(`Game ${gameId} not found on server (404): ${url}`);
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Server returned ${response.status} for ${url}: ${errorText || response.statusText}`);
  }
  const body = await response.json() as Envelope;
  if (body.data === undefined || body.data === null) {
    throw new Error(`Server response for ${url} is missing data: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body;
}

function reportFetchError(error: unknown, serverUrl: string, gameId: string): void {
  const err = error as { message?: string; cause?: { code?: string } };
  if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch')) {
    console.error(chalk.red(`\n❌ Cannot connect to server at ${serverUrl}`));
    console.error(chalk.gray('   Make sure the server is running: pnpm run dev --filter=@mafia/server'));
  } else {
    console.error(chalk.red(`\n❌ ${gameId} failed: ${err.message}`));
  }
}
