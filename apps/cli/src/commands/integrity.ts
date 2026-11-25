/**
 * Integrity Command — corpus integrity report (MAF-INIT-001).
 *
 * `mafiactl integrity-report [--db <path>] [--json]` reads a SQLite game
 * database DIRECTLY (no server, no docker) and prints the six gate counts:
 * total, ENDED, CANCELLED, single-model, mixed-model, unattributed,
 * with-cost. MAF-LAYER-4's site generator requires this report as input,
 * so `--json` emits a single machine-readable line.
 *
 * The report is read-only: the database is opened with `readonly: true` and
 * `fileMustExist: true`, so a wrong path fails loudly instead of creating
 * an empty file that would report all-zero counts.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Database from 'better-sqlite3';
import { resolveDbPath } from '../config.js';
import {
  computeIntegrityCounts,
  renderIntegrityTable,
  serializeIntegrityJson,
} from '../integrity-format.js';

export class IntegrityReportCommand extends Command {
  constructor() {
    super('integrity-report');
    this.description(
      'Corpus integrity counts (total, ENDED, CANCELLED, single/mixed/unattributed, with-cost) ' +
        'read directly from a SQLite game DB (MAF-INIT-001)',
    );
    this.option('--db <path>', 'SQLite game database path (default: data/mafia.db)');
    this.option('--json', 'Emit a single machine-readable JSON line (MAF-LAYER-4 input)');

    this.action(async () => { await this.run(); });
  }

  async run(): Promise<void> {
    const { db: dbPath, json } = this.opts<{ db?: string; json?: boolean }>();
    const resolved = resolveDbPath(dbPath);

    let db: Database.Database;
    try {
      db = new Database(resolved, { readonly: true, fileMustExist: true });
    } catch (error) {
      const err = error as { message?: string };
      console.error(chalk.red(`❌ Cannot open game database at ${resolved}: ${err.message}`));
      console.error(chalk.gray('   Pass the path explicitly: mafiactl integrity-report --db <path>'));
      process.exit(1);
    }

    try {
      const counts = computeIntegrityCounts(db);
      if (json) {
        // Gate contract: exactly one JSON line on stdout.
        console.log(serializeIntegrityJson(counts).trimEnd());
      } else {
        console.log(renderIntegrityTable(counts));
      }
    } catch (error) {
      const err = error as { message?: string };
      console.error(chalk.red(`❌ Integrity report failed: ${err.message}`));
      process.exit(1);
    } finally {
      db.close();
    }
  }
}
