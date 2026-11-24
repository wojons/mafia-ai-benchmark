/**
 * Metrics Command — per-player/per-model metrics derived from the run-record
 * corpus (MAF-LAYER-2).
 *
 * - `mafiactl metrics derive <runs-dir> [--out <dir>]` reads every run file
 *   in <runs-dir> and writes one metrics file per run:
 *   <out>/<game_id>/metrics.jsonl (a single RunMetricsRecord line). Exactly
 *   one metrics line per run is printed to stdout (pipeable); status and
 *   warnings go to stderr.
 * - `mafiactl metrics aggregate <metrics-dir>` consumes those metrics files
 *   and prints the per-model table: win_rate, survival (overall + by role),
 *   vote_accuracy, persuasion (followers gained per speech), lie_rate and
 *   games_played — each metric with its sample n; n < 5 carries a `*`
 *   low-sample marker.
 *
 * tokens/cost_usd are always null in derived metrics: the run corpus records
 * no per-player token usage or cost anywhere (grep-verified over the full
 * corpus, 2026-11-24) — the deriver never invents values.
 *
 * Input discipline: the deriver reads ONLY MAF-LAYER-1 run files; the
 * aggregator reads ONLY derived metrics files. Neither reads the legacy
 * win-flag-only aggregates (stats-collector / benchmark outputs).
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import type { ModelAggregate, RunMetricsRecord } from '@mafia/shared/types';
import {
  aggregateModels,
  countUnattributedSeats,
  deriveRunMetrics,
  parseRunFile,
  renderModelTable,
  serializeMetricsLine,
} from '../metrics-format.js';

/** Data dir resolution: --out > MAFIA_METRICS_DIR > 'data/metrics' (cwd-relative). */
function resolveMetricsOutDir(cliOutDir?: string): string {
  return cliOutDir || process.env.MAFIA_METRICS_DIR || 'data/metrics';
}

export class MetricsCommand extends Command {
  constructor() {
    super('metrics');
    this.description('Per-run metrics derivation + per-model aggregation (MAF-LAYER-2)');

    this.addCommand(new MetricsDeriveCommand());
    this.addCommand(new MetricsAggregateCommand());

    this.action(() => {
      this.help();
    });
  }
}

export class MetricsDeriveCommand extends Command {
  constructor() {
    super('derive');
    this.description(
      'Derive one metrics file (metrics.jsonl) per run from real event sequences ' +
      '(tokens/cost_usd stay null — the corpus records none)',
    );
    this.argument('<runs-dir>', 'Directory of MAF-LAYER-1 run files (*.jsonl; index.jsonl is skipped)');
    this.option('--out <dir>', 'Metrics output directory (default: data/metrics)');

    this.action(async (runsDir: string) => { await this.run(runsDir); });
  }

  async run(runsDir: string): Promise<void> {
    const { out } = this.opts();
    const outDir = resolveMetricsOutDir(out);

    try {
      const outcome = deriveMetricsDir(runsDir, outDir);

      // Gate contract: exactly one metrics line per run on stdout.
      for (const line of outcome.metricsLines) {
        console.log(line.trimEnd());
      }
      console.error(
        chalk.green(`✅ Derived metrics for ${outcome.derived}/${outcome.total} run file(s) → ${outDir}`),
      );
      for (const problem of outcome.unparsed) {
        console.error(chalk.yellow(`⚠️ Skipped non-run file: ${problem}`));
      }
      if (outcome.derived === 0) {
        console.error(chalk.red(`\n❌ No run files under ${runsDir} produced metrics.`));
        process.exit(1);
      }
    } catch (error) {
      const err = error as { message?: string };
      console.error(chalk.red(`\n❌ Derive failed: ${err.message}`));
      process.exit(1);
    }
  }
}

export class MetricsAggregateCommand extends Command {
  constructor() {
    super('aggregate');
    this.description('Aggregate derived metrics files into the per-model table');
    this.argument('[metrics-dir]', 'Directory containing derived metrics files (default: data/metrics)', 'data/metrics');
    this.option('--out <file>', 'Also write the aggregate as JSONL (one model row per line) to this path');

    this.action(async (metricsDir: string) => { await this.run(metricsDir); });
  }

  async run(metricsDir: string): Promise<void> {
    const { out } = this.opts();

    try {
      const records = readMetricsDir(metricsDir);
      const aggregates = aggregateModels(records);

      // Gate contract: a per-model table row for every model, each metric
      // with its sample n.
      console.log(renderModelTable(aggregates));

      const unattributed = countUnattributedSeats(records);
      if (unattributed > 0) {
        console.error(
          chalk.yellow(`⚠️ ${unattributed} seat(s) carry no model attribution and are excluded from the table.`),
        );
      }

      if (out) {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, aggregates.map(serializeAggregateLine).join(''), 'utf-8');
        console.error(chalk.green(`✅ Aggregate written: ${out} (${aggregates.length} model row(s))`));
      }
      if (aggregates.length === 0) {
        console.error(chalk.red(`\n❌ No attributed model seats found under ${metricsDir}.`));
        process.exit(1);
      }
    } catch (error) {
      const err = error as { message?: string };
      console.error(chalk.red(`\n❌ Aggregate failed: ${err.message}`));
      process.exit(1);
    }
  }
}

/**
 * Derive metrics for every run file in runsDir, writing one metrics file per
 * run (<out>/<game_id>/metrics.jsonl). Pure derivation lives in
 * metrics-format.ts; this orchestrates the file I/O. Non-run files are
 * skipped with a warning, never fatal — a corpus may contain strays.
 */
export function deriveMetricsDir(
  runsDir: string,
  outDir: string,
): { metricsLines: string[]; derived: number; total: number; unparsed: string[] } {
  if (!fs.existsSync(runsDir)) {
    throw new Error(`Runs directory not found: ${runsDir}`);
  }
  const runFiles = fs.readdirSync(runsDir)
    .filter((f) => f.endsWith('.jsonl') && f !== 'index.jsonl')
    .sort();

  const metricsLines: string[] = [];
  const unparsed: string[] = [];
  let derived = 0;
  for (const fileName of runFiles) {
    const filePath = path.join(runsDir, fileName);
    try {
      const { record, events, tornEventLines } = parseRunFile(
        fs.readFileSync(filePath, 'utf-8'),
        fileName,
      );
      const metrics = deriveRunMetrics(record, events);
      const line = serializeMetricsLine(metrics);

      const runOutDir = path.join(outDir, metrics.game_id);
      fs.mkdirSync(runOutDir, { recursive: true });
      fs.writeFileSync(path.join(runOutDir, 'metrics.jsonl'), line, 'utf-8');

      metricsLines.push(line);
      derived += 1;
      if (tornEventLines > 0) {
        unparsed.push(`${fileName}: skipped ${tornEventLines} torn event line(s)`);
      }
    } catch (error) {
      unparsed.push(`${fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { metricsLines, derived, total: runFiles.length, unparsed };
}

/** Read every metrics file under metricsDir (any depth, named metrics.jsonl). */
export function readMetricsDir(metricsDir: string): RunMetricsRecord[] {
  if (!fs.existsSync(metricsDir)) {
    throw new Error(`Metrics directory not found: ${metricsDir}`);
  }
  const records: RunMetricsRecord[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.name === 'metrics.jsonl') {
        for (const line of fs.readFileSync(fullPath, 'utf-8').split('\n')) {
          if (line.trim() === '') continue;
          records.push(JSON.parse(line) as RunMetricsRecord);
        }
      }
    }
  };
  visit(metricsDir);
  return records;
}

/** Serialize one model aggregate as its single JSONL line. */
function serializeAggregateLine(aggregate: ModelAggregate): string {
  return JSON.stringify(aggregate) + '\n';
}
