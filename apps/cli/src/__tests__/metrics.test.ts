/**
 * Tests for the metrics deriver + per-model aggregator (MAF-LAYER-2).
 *
 * Everything runs on a small SYNTHETIC fixture corpus with hand-computed
 * outcomes — never the real data/runs corpus (input-only). The fixture
 * covers: survival, vote accuracy, voted-out-incorrect, majority follow
 * rate, speech flips, night-kill accuracy, THINK-vs-SAYS lie rate
 * (including the exact Jaccard boundary), null tokens/cost, per-model
 * aggregation with sample n's + the low-sample marker, and the real-argv
 * gate behaviors (deriver prints one metrics line per run; aggregator
 * prints a per-model table row for every model).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { createRequire } from 'module';

import type { RunEventLine, RunMetricsRecord, RunRecord, RunSeat } from '@mafia/shared/types';
import {
  LIE_SIMILARITY_THRESHOLD,
  LOW_SAMPLE_N,
  aggregateModels,
  countUnattributedSeats,
  deriveRunMetrics,
  orderRunEvents,
  parseRunFile,
  serializeMetricsLine,
  wordJaccard,
} from '../metrics-format.js';
import { deriveMetricsDir, readMetricsDir } from '../commands/metrics.js';
import { MetricsCommand } from '../commands/metrics.js';

const execFileAsync = promisify(execFile);
const nodeRequire = createRequire(__filename);
const tsxCli = nodeRequire.resolve('tsx/cli');
const cliEntry = path.resolve(__dirname, '../index.ts');

// ---------- fixture builders ----------

const TS_BASE = '2026-11-21T01:00:00.000Z';

function ts(sequence: number): string {
  return TS_BASE.replace('01:00:00', `01:${String(Math.floor(sequence / 60)).padStart(2, '0')}:${String(sequence % 60).padStart(2, '0')}`);
}

function ev(sequence: number, overrides: Partial<RunEventLine> = {}): RunEventLine {
  return {
    id: `e${sequence}`,
    type: 'PHASE_CHANGED',
    timestamp: ts(sequence),
    actor_id: null,
    visibility: 'PUBLIC',
    data: {},
    metadata: { sequence, turnNumber: sequence, dayNumber: 1, phase: 'DAY' },
    ...overrides,
  };
}

function saysEvent(
  player: string,
  sequence: number,
  day: number,
  text: string,
  opts: { think?: string; turn?: number } = {},
): RunEventLine {
  return ev(sequence, {
    type: 'AGENT_SAYS_BROADCASTED',
    actor_id: player,
    data: opts.think ? { says: text, think: opts.think } : { says: text },
    metadata: { sequence, turnNumber: opts.turn ?? sequence, dayNumber: day, phase: 'DAY' },
  });
}

function thinkEvent(player: string, sequence: number, day: number, text: string): RunEventLine {
  return ev(sequence, {
    type: 'AGENT_THINK_COMPLETED',
    actor_id: player,
    visibility: 'ADMIN',
    data: { playerId: player, think: text },
    metadata: { sequence, turnNumber: sequence, dayNumber: day, phase: 'NIGHT' },
  });
}

function voteEvent(voter: string, target: string, sequence: number, day: number): RunEventLine {
  return ev(sequence, {
    type: 'VOTE_CAST',
    actor_id: voter,
    data: { targetId: target, says: `I vote ${target}` },
    metadata: { sequence, turnNumber: sequence, dayNumber: day, phase: 'DAY_VOTING' },
  });
}

function lynchEvent(sequence: number, day: number, ids: string[]): RunEventLine {
  return ev(sequence, {
    type: 'PLAYER_LYNCHED',
    data: { deaths: ids.map((id) => ({ id })) },
    metadata: { sequence, turnNumber: sequence, dayNumber: day, phase: 'DAY_VOTING' },
  });
}

function nightKillEvent(killer: string, target: string, sequence: number, day: number): RunEventLine {
  return ev(sequence, {
    type: 'NIGHT_ACTION_SUBMITTED',
    actor_id: killer,
    visibility: 'ADMIN',
    data: { targetId: target },
    metadata: { sequence, turnNumber: sequence, dayNumber: day, phase: 'NIGHT' },
  });
}

function morningRevealEvent(sequence: number, day: number, deadIds: string[]): RunEventLine {
  return ev(sequence, {
    type: 'MORNING_REVEAL',
    data: { deaths: deadIds.map((id) => ({ id })) },
    metadata: { sequence, turnNumber: sequence, dayNumber: day, phase: 'MORNING_REVEAL' },
  });
}

function seat(playerId: string, model: string | null, role: string, survived: boolean, won: number | null): RunSeat {
  return { seat: 1, player_id: playerId, provider: 'test', model, role, survived, won };
}

function runRecord(gameId: string, winner: string | null, seats: RunSeat[]): RunRecord {
  return {
    game_id: gameId,
    started_at: TS_BASE,
    ended_at: TS_BASE,
    num_players: seats.length,
    winner,
    provenance: 'single',
    seats: seats.map((s, i) => ({ ...s, seat: i + 1 })),
  };
}

/**
 * game-r1: TOWN wins. p1 is the lone mafia (model-a); day 1 the town
 * lynch-mobs the doctor p3 (every shooter voted p3 → voted_out_incorrect);
 * night 1 p1's kill on p2 lands (night_kill_correct); day 2 the town lynches
 * p1. p1/p2/p5 get one THINK/SAYS turn pair each: identical text (no lie),
 * disjoint text (lie), and the exact-boundary Jaccard (1/5 — not a lie).
 */
function r1Events(): RunEventLine[] {
  return [
    saysEvent('p1', 1, 1, 'speech one from p1'),
    saysEvent('p2', 2, 1, 'speech one from p2'),
    saysEvent('p3', 3, 1, 'speech one from p3'),
    saysEvent('p4', 4, 1, 'speech one from p4'),
    saysEvent('p5', 5, 1, 'speech one from p5'),
    voteEvent('p1', 'p3', 10, 1),
    voteEvent('p2', 'p3', 11, 1),
    voteEvent('p3', 'p1', 12, 1),
    voteEvent('p4', 'p3', 13, 1),
    voteEvent('p5', 'p3', 14, 1),
    lynchEvent(15, 1, ['p3']),
    nightKillEvent('p1', 'p2', 20, 2),
    morningRevealEvent(21, 2, ['p2']),
    saysEvent('p1', 30, 2, 'speech two from p1'),
    saysEvent('p5', 31, 2, 'speech two from p5'),
    voteEvent('p1', 'p5', 32, 2),
    voteEvent('p4', 'p1', 33, 2),
    voteEvent('p5', 'p1', 34, 2),
    lynchEvent(35, 2, ['p1']),
    // THINK/SAYS pairs in the two real corpus shapes:
    // (a) with-THINK era — private THINK event at turn N, public SAYS at
    //     turn N+1, same player, no data.think on the SAYS event;
    // (b) split-pane era — data.think + data.says attached to one SAYS event.
    thinkEvent('p1', 50, 3, 'I will vote for the doctor now'),
    saysEvent('p1', 51, 3, 'I will vote for the doctor now', { turn: 51 }), // (a) identical -> no lie
    thinkEvent('p2', 52, 3, 'I suspect the mafia entirely different words here'),
    saysEvent('p2', 53, 3, 'let us all be friends and peace forever', { turn: 53 }), // (a) disjoint -> lie
    thinkEvent('p5', 54, 3, 'alpha beta gamma'),
    saysEvent('p5', 55, 3, 'alpha delta epsilon', { turn: 55 }), // (a) jaccard exactly the threshold -> no lie
    saysEvent('p4', 56, 3, 'I completely trust everyone here my friends', { think: 'they suspect me I must deflect now', turn: 56 }), // (b) disjoint -> lie
    ev(60, { type: 'GAME_ENDED', data: { winner: 'TOWN' } }),
  ];
}

function r1Record(): RunRecord {
  return runRecord('game-r1', 'TOWN', [
    seat('p1', 'test-model-a', 'MAFIA', false, 0),
    seat('p2', 'test-model-a', 'VILLAGER', false, 1),
    seat('p3', 'test-model-b', 'DOCTOR', false, 1),
    seat('p4', 'test-model-b', 'SHERIFF', true, 1),
    seat('p5', 'test-model-a', 'VILLAGER', true, 1),
  ]);
}

/**
 * game-r2: MAFIA wins, every seat model-b. One lynch (p2, an innocent),
 * one landed night kill (p3), no speeches at all (persuasion n/a).
 */
function r2Events(): RunEventLine[] {
  return [
    voteEvent('p1', 'p2', 1, 1),
    voteEvent('p3', 'p2', 2, 1),
    lynchEvent(3, 1, ['p2']),
    nightKillEvent('p1', 'p3', 4, 1),
    morningRevealEvent(5, 1, ['p3']),
    ev(6, { type: 'GAME_ENDED', data: { winner: 'MAFIA' } }),
  ];
}

function r2Record(): RunRecord {
  return runRecord('game-r2', 'MAFIA', [
    seat('p1', 'test-model-b', 'MAFIA', true, 1),
    seat('p2', 'test-model-b', 'VILLAGER', false, 0),
    seat('p3', 'test-model-b', 'VILLAGER', false, 0),
  ]);
}

/** game-r3: a single unattributed seat (model null) — never ranked. */
function r3Record(): RunRecord {
  return runRecord('game-r3', 'TOWN', [seat('p1', null, 'MAFIA', true, null)]);
}

function r3Events(): RunEventLine[] {
  return [ev(1, { type: 'GAME_ENDED', data: { winner: 'TOWN' } })];
}

function serializeRunFile(record: RunRecord, events: RunEventLine[]): string {
  return [JSON.stringify(record), ...events.map((e) => JSON.stringify(e))].join('\n') + '\n';
}

const tmpDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function fixtureRunsDir(withIndex: boolean): string {
  const runsDir = makeTempDir('mafia-metrics-runs-');
  writeFileSync(path.join(runsDir, 'game-r1.jsonl'), serializeRunFile(r1Record(), r1Events()), 'utf-8');
  writeFileSync(path.join(runsDir, 'game-r2.jsonl'), serializeRunFile(r2Record(), r2Events()), 'utf-8');
  writeFileSync(path.join(runsDir, 'game-r3.jsonl'), serializeRunFile(r3Record(), r3Events()), 'utf-8');
  if (withIndex) {
    writeFileSync(path.join(runsDir, 'index.jsonl'), '{"game_id":"game-r1"}\n', 'utf-8');
  }
  return runsDir;
}

// Hand-computed expectations for game-r1 (see builder doc).
const R1_EXPECTED: Record<string, {
  survived: boolean; votes_cast: number; votes_correct: number; voted_out_incorrect: number;
  majority_follow_rate: number | null; speech_flip_events: number; night_kill_correct: number;
  think_says_lie_rate: number | null; speeches: number; followers_gained: number;
}> = {
  p1: { survived: false, votes_cast: 2, votes_correct: 0, voted_out_incorrect: 1, majority_follow_rate: 0.5, speech_flip_events: 1, night_kill_correct: 1, think_says_lie_rate: 0.0, speeches: 3, followers_gained: 3 },
  p2: { survived: false, votes_cast: 1, votes_correct: 0, voted_out_incorrect: 1, majority_follow_rate: 1.0, speech_flip_events: 0, night_kill_correct: 0, think_says_lie_rate: 1.0, speeches: 2, followers_gained: 3 },
  p3: { survived: false, votes_cast: 1, votes_correct: 1, voted_out_incorrect: 0, majority_follow_rate: 0.0, speech_flip_events: 0, night_kill_correct: 0, think_says_lie_rate: null, speeches: 1, followers_gained: 0 },
  p4: { survived: true, votes_cast: 2, votes_correct: 1, voted_out_incorrect: 1, majority_follow_rate: 1.0, speech_flip_events: 1, night_kill_correct: 0, think_says_lie_rate: 1.0, speeches: 2, followers_gained: 3 },
  p5: { survived: true, votes_cast: 2, votes_correct: 1, voted_out_incorrect: 1, majority_follow_rate: 1.0, speech_flip_events: 1, night_kill_correct: 0, think_says_lie_rate: 0.0, speeches: 3, followers_gained: 4 },
};

// ---------- wordJaccard + threshold ----------

describe('wordJaccard (THINK-vs-SAYS similarity)', () => {
  it('identical text scores 1', () => {
    expect(wordJaccard('I will vote for the doctor now', 'I will vote for the doctor now')).toBe(1);
  });

  it('disjoint text scores 0', () => {
    expect(wordJaccard('kill the sheriff tonight quietly', 'let us all be friends and peace forever')).toBe(0);
  });

  it('boundary: 1 shared word of 5 distinct scores exactly the threshold', () => {
    expect(wordJaccard('alpha beta gamma', 'alpha delta epsilon')).toBeCloseTo(LIE_SIMILARITY_THRESHOLD, 10);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(wordJaccard('Vote, Alice!', 'vote alice')).toBe(1);
  });

  it('returns null when either side has no words (unmeasurable pair)', () => {
    expect(wordJaccard('', 'some words')).toBeNull();
    expect(wordJaccard('some words', '')).toBeNull();
  });
});

// ---------- deriver: exact per-player metrics ----------

describe('deriveRunMetrics (game-r1 exact outcomes)', () => {
  const metrics = deriveRunMetrics(r1Record(), orderRunEvents(r1Events()));
  const byPlayer = new Map(metrics.per_player.map((p) => [p.player_id, p]));

  it('asserts the hand-computed outcome for every player and every metric', () => {
    expect(metrics.game_id).toBe('game-r1');
    expect(metrics.per_player).toHaveLength(5);
    for (const [playerId, expected] of Object.entries(R1_EXPECTED)) {
      const player = byPlayer.get(playerId);
      expect(player, `player ${playerId}`).toBeDefined();
      expect(player?.survived).toBe(expected.survived);
      expect(player?.votes_cast).toBe(expected.votes_cast);
      expect(player?.votes_correct).toBe(expected.votes_correct);
      expect(player?.voted_out_incorrect).toBe(expected.voted_out_incorrect);
      expect(player?.majority_follow_rate ?? null).toBeCloseTo(expected.majority_follow_rate ?? -1, 10);
      expect(player?.speech_flip_events).toBe(expected.speech_flip_events);
      expect(player?.night_kill_correct).toBe(expected.night_kill_correct);
      if (expected.think_says_lie_rate === null) {
        expect(player?.think_says_lie_rate).toBeNull();
      } else {
        expect(player?.think_says_lie_rate ?? -1).toBeCloseTo(expected.think_says_lie_rate, 10);
      }
      expect(player?.speeches).toBe(expected.speeches);
      expect(player?.followers_gained).toBe(expected.followers_gained);
    }
  });

  it('never fabricates tokens/cost — always null (corpus records none)', () => {
    for (const player of metrics.per_player) {
      expect(player.tokens).toBeNull();
      expect(player.cost_usd).toBeNull();
    }
  });

  it('keeps seat identity + attribution from the run header', () => {
    const p1 = byPlayer.get('p1');
    expect(p1).toMatchObject({ player_id: 'p1', model: 'test-model-a', role: 'MAFIA', won: 0 });
    const p3 = byPlayer.get('p3');
    expect(p3).toMatchObject({ model: 'test-model-b', role: 'DOCTOR', won: 1 });
  });

  it('lie rate pairs the private THINK event with the same speak-turn SAYS (criterion 3)', () => {
    // p1 thought and said the same words -> 0.0; p2 said something disjoint
    // from the private thought -> 1.0; p5 sits exactly at the Jaccard
    // threshold -> NOT a lie (strict <); p3 has no THINK evidence -> null.
    expect(byPlayer.get('p1')?.think_says_pairs).toBe(1);
    expect(byPlayer.get('p2')?.think_says_lies).toBe(1);
    expect(byPlayer.get('p5')?.think_says_pairs).toBe(1);
    expect(byPlayer.get('p5')?.think_says_lies).toBe(0);
    expect(byPlayer.get('p3')?.think_says_lie_rate).toBeNull();
  });

  it('split-pane shape: data.think attached to the SAYS event pairs in-event', () => {
    // p4's only THINK evidence is the data.think attached to its SAYS event
    // (the old-era shape) — disjoint from its says -> a measured lie.
    expect(byPlayer.get('p4')?.think_says_pairs).toBe(1);
    expect(byPlayer.get('p4')?.think_says_lies).toBe(1);
    expect(byPlayer.get('p4')?.think_says_lie_rate ?? -1).toBeCloseTo(1.0, 10);
  });
});

describe('deriveRunMetrics (game-r2 + edges)', () => {
  const metrics = deriveRunMetrics(r2Record(), orderRunEvents(r2Events()));
  const byPlayer = new Map(metrics.per_player.map((p) => [p.player_id, p]));

  it('single-model game: mafia kill accuracy and innocent-lynch votes', () => {
    expect(byPlayer.get('p1')).toMatchObject({ votes_cast: 1, votes_correct: 0, voted_out_incorrect: 1, night_kill_correct: 1 });
    expect(byPlayer.get('p3')).toMatchObject({ votes_cast: 1, votes_correct: 0, voted_out_incorrect: 1, night_kill_correct: 0 });
  });

  it('a player with no votes on any lynch day has null majority_follow_rate', () => {
    expect(byPlayer.get('p2')?.majority_follow_rate).toBeNull();
  });

  it('a player with no measurable THINK/SAYS pairs has null lie rate', () => {
    for (const player of metrics.per_player) {
      expect(player.think_says_lie_rate).toBeNull();
      expect(player.think_says_pairs).toBe(0);
    }
  });

  it('a night kill with no following MORNING_REVEAL is uncounted, not guessed', () => {
    const events = r2Events().filter((e) => e.type !== 'MORNING_REVEAL');
    const noReveal = deriveRunMetrics(r2Record(), orderRunEvents(events));
    expect(noReveal.per_player[0].night_kill_correct).toBe(0);
  });

  it('a night kill saved by the doctor (target alive at reveal) is uncounted', () => {
    const events = r2Events().map((e) =>
      e.type === 'MORNING_REVEAL' ? morningRevealEvent(5, 1, []) : e,
    );
    const saved = deriveRunMetrics(r2Record(), orderRunEvents(events));
    expect(saved.per_player[0].night_kill_correct).toBe(0);
  });

  it('night actions by non-kill roles never count as kills', () => {
    const events = [
      nightKillEvent('p2', 'p1', 1, 1), // p2 is a VILLAGER in r2
      morningRevealEvent(2, 1, ['p1']),
    ];
    const derived = deriveRunMetrics(r2Record(), orderRunEvents(events));
    expect(derived.per_player.map((p) => p.night_kill_correct)).toEqual([0, 0, 0]);
  });
});

describe('parseRunFile (run file parsing)', () => {
  it('round-trips a run file into header + ordered events', () => {
    const body = serializeRunFile(r1Record(), r1Events());
    const parsed = parseRunFile(body, 'game-r1.jsonl');
    expect(parsed.record.game_id).toBe('game-r1');
    expect(parsed.events).toHaveLength(r1Events().length);
    expect(parsed.tornEventLines).toBe(0);
  });

  it('skips torn event lines and counts them', () => {
    const body = serializeRunFile(r1Record(), r1Events()) + '{"torn line\n';
    const parsed = parseRunFile(body, 'game-r1.jsonl');
    expect(parsed.tornEventLines).toBe(1);
    expect(parsed.events).toHaveLength(r1Events().length);
  });

  it('rejects a file whose header line is torn (run unidentifiable, file named)', () => {
    expect(() => parseRunFile('{torn\n{"id":"e1"}\n', 'bad.jsonl')).toThrow(/bad\.jsonl/);
  });
});

// ---------- aggregator: exact per-model table ----------

describe('aggregateModels (exact per-model values)', () => {
  const records: RunMetricsRecord[] = [r1Record(), r2Record(), r3Record()].map((record, i) =>
    deriveRunMetrics(record, orderRunEvents([r1Events(), r2Events(), r3Events()][i])),
  );

  it('one row per attributed model, sorted; games_played counts distinct runs', () => {
    const aggregates = aggregateModels(records);
    expect(aggregates.map((a) => a.model)).toEqual(['test-model-a', 'test-model-b']);
    expect(aggregates[0].games_played).toBe(1);
    expect(aggregates[1].games_played).toBe(2);
  });

  it('model-a: hand-computed win_rate, survival, vote_accuracy, persuasion, lie_rate with sample n', () => {
    const a = aggregateModels(records)[0];
    expect(a.win_rate).toEqual({ value: 2 / 3, n: 3, low_sample: true });
    expect(a.survival).toEqual({ value: 1 / 3, n: 3, low_sample: true });
    // 5 votes pooled, 1 correct (p5's day-2 vote on the mafia).
    expect(a.vote_accuracy).toEqual({ value: 0.2, n: 5, low_sample: false });
    // 10 followers pooled over 8 speeches (p1 3/3, p2 3/2, p5 4/3).
    expect(a.persuasion).toEqual({ value: 1.25, n: 8, low_sample: false });
    // 1 lie over 3 measurable pairs.
    expect(a.lie_rate).toEqual({ value: 1 / 3, n: 3, low_sample: true });
    expect(a.survival_by_role).toEqual({
      MAFIA: { value: 0, n: 1, low_sample: true },
      VILLAGER: { value: 0.5, n: 2, low_sample: true },
    });
  });

  it('model-b: n=5 metrics carry NO low-sample marker; empty lie pairs stay null', () => {
    const b = aggregateModels(records)[1];
    expect(b.win_rate).toEqual({ value: 0.6, n: 5, low_sample: false });
    expect(b.survival).toEqual({ value: 0.4, n: 5, low_sample: false });
    expect(b.vote_accuracy).toEqual({ value: 0.4, n: 5, low_sample: false });
    // p4's day-3 split-pane SAYS adds a speech (3 pooled) with no new followers.
    expect(b.persuasion).toEqual({ value: 1.0, n: 3, low_sample: true });
    // p4's split-pane lie is model-b's only measurable pair, and it lied.
    expect(b.lie_rate).toEqual({ value: 1.0, n: 1, low_sample: true });
    expect(b.survival_by_role).toEqual({
      DOCTOR: { value: 0, n: 1, low_sample: true },
      MAFIA: { value: 1, n: 1, low_sample: true },
      SHERIFF: { value: 1, n: 1, low_sample: true },
      VILLAGER: { value: 0, n: 2, low_sample: true },
    });
  });

  it('unattributed seats are counted, never ranked as a model', () => {
    expect(countUnattributedSeats(records)).toBe(1);
    expect(aggregateModels(records).map((a) => a.model)).not.toContain(null);
  });
});

// ---------- table render ----------

describe('renderModelTable (gate-visible output)', () => {
  const records: RunMetricsRecord[] = [r1Record(), r2Record()].map((record, i) =>
    deriveRunMetrics(record, orderRunEvents([r1Events(), r2Events()][i])),
  );
  const table = aggregateModels(records);
  // renderModelTable is imported lazily to keep the import list at top honest.

  it('prints one row per model with sample n for every metric', async () => {
    const { renderModelTable } = await import('../metrics-format.js');
    const rendered = renderModelTable(table);
    for (const model of ['test-model-a', 'test-model-b']) {
      expect(rendered).toContain(model);
    }
    expect(rendered).toContain('(n=5)');
    expect(rendered).toContain('survival by role:');
  });

  it('marks n<5 metrics and leaves n>=5 unmarked', async () => {
    const { renderModelTable } = await import('../metrics-format.js');
    const rendered = renderModelTable(table);
    // model-a win_rate n=3 -> marked; model-b win_rate n=5 -> unmarked.
    expect(rendered).toMatch(/test-model-a\s+1\s+0\.667 \(n=3\)\*/);
    expect(rendered).toMatch(/test-model-b\s+2\s+0\.600 \(n=5\)/);
    expect(rendered).toContain(`* low sample (n < ${LOW_SAMPLE_N})`);
  });

  it('renders a stable no-attribution message for an empty corpus', async () => {
    const { renderModelTable } = await import('../metrics-format.js');
    expect(renderModelTable([])).toMatch(/No attributed model seats/);
  });
});

// ---------- file orchestration + gate behaviors ----------

describe('deriveMetricsDir + readMetricsDir (fixture corpus)', () => {
  it('writes one metrics.jsonl per run, skips index.jsonl, warns on strays', () => {
    const runsDir = fixtureRunsDir(true);
    writeFileSync(path.join(runsDir, 'broken.jsonl'), '{torn header\n', 'utf-8');
    const outDir = path.join(makeTempDir('mafia-metrics-out-'), 'metrics');
    const outcome = deriveMetricsDir(runsDir, outDir);

    expect(outcome.derived).toBe(3);
    expect(outcome.total).toBe(4); // includes broken.jsonl, excludes index.jsonl
    expect(outcome.metricsLines).toHaveLength(3);
    expect(outcome.unparsed.some((u) => u.includes('broken.jsonl'))).toBe(true);

    // One metrics file per run: <out>/<game_id>/metrics.jsonl.
    for (const gameId of ['game-r1', 'game-r2', 'game-r3']) {
      const file = path.join(outDir, gameId, 'metrics.jsonl');
      expect(existsSync(file)).toBe(true);
      const lines = readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim() !== '');
      expect(lines).toHaveLength(1); // a single RunMetricsRecord line
      expect((JSON.parse(lines[0]) as RunMetricsRecord).game_id).toBe(gameId);
    }

    // The aggregator consumes the derived files back.
    const records = readMetricsDir(outDir);
    expect(records).toHaveLength(3);
    expect(aggregateModels(records).map((a) => a.model)).toEqual(['test-model-a', 'test-model-b']);
  });

  it('criterion 5: the deriver needs ONLY run files — no index.jsonl, no legacy aggregates', () => {
    const runsDir = fixtureRunsDir(false); // no index.jsonl at all
    const outDir = path.join(makeTempDir('mafia-metrics-out2-'), 'metrics');
    const outcome = deriveMetricsDir(runsDir, outDir);
    expect(outcome.derived).toBe(3);
    expect(outcome.unparsed).toHaveLength(0);
  });

  it('metrics lines round-trip through serializeMetricsLine', () => {
    const metrics = deriveRunMetrics(r1Record(), orderRunEvents(r1Events()));
    const line = serializeMetricsLine(metrics);
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual(metrics);
  });
});

// ---------- real-argv gate behaviors (spawn the actual CLI) ----------

async function runCli(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [tsxCli, cliEntry, ...args],
      { cwd, env: process.env, timeout: 60000 },
    );
    return { stdout, stderr, code: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      code: typeof err.code === 'number' ? err.code : 1,
    };
  }
}

describe('metrics commands (real argv path — gate arm)', () => {
  let cwd: string;

  afterEach(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  it('derive prints exactly one metrics line per run and writes the files', async () => {
    cwd = makeTempDir('mafia-metrics-e2e-');
    const runsDir = path.join(cwd, 'runs');
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(path.join(runsDir, 'game-r1.jsonl'), serializeRunFile(r1Record(), r1Events()), 'utf-8');
    writeFileSync(path.join(runsDir, 'game-r2.jsonl'), serializeRunFile(r2Record(), r2Events()), 'utf-8');
    const outDir = path.join(cwd, 'metrics');

    const { stdout, stderr, code } = await runCli(cwd, ['metrics', 'derive', runsDir, '--out', outDir]);
    expect(code).toBe(0);

    const lines = stdout.split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(2); // one metrics line per run — nothing else on stdout
    const parsed = lines.map((l) => JSON.parse(l) as RunMetricsRecord);
    expect(parsed.map((r) => r.game_id)).toEqual(['game-r1', 'game-r2']);
    expect(parsed[0].per_player).toHaveLength(5);
    expect(parsed[0].per_player[0].tokens).toBeNull();
    expect(stderr).toContain('2/2 run file(s)');
    expect(existsSync(path.join(outDir, 'game-r1', 'metrics.jsonl'))).toBe(true);
    expect(existsSync(path.join(outDir, 'game-r2', 'metrics.jsonl'))).toBe(true);
  }, 90000);

  it('aggregate prints a per-model table row for every model with its sample n', async () => {
    cwd = makeTempDir('mafia-metrics-e2e2-');
    const runsDir = path.join(cwd, 'runs');
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(path.join(runsDir, 'game-r1.jsonl'), serializeRunFile(r1Record(), r1Events()), 'utf-8');
    writeFileSync(path.join(runsDir, 'game-r2.jsonl'), serializeRunFile(r2Record(), r2Events()), 'utf-8');
    const outDir = path.join(cwd, 'metrics');

    const derived = await runCli(cwd, ['metrics', 'derive', runsDir, '--out', outDir]);
    expect(derived.code).toBe(0);

    const aggregateOut = path.join(cwd, 'aggregate.jsonl');
    const { stdout, code } = await runCli(cwd, ['metrics', 'aggregate', outDir, '--out', aggregateOut]);
    expect(code).toBe(0);

    // A table row for every model, each metric cell carrying (n=...).
    expect(stdout).toContain('test-model-a');
    expect(stdout).toContain('test-model-b');
    expect(stdout).toMatch(/win_rate.*survival.*vote_accuracy.*persuasion.*lie_rate/s);
    expect(stdout).toContain('(n=5)');
    expect(stdout).toContain('* low sample (n < 5)');

    // Machine-readable aggregate: one line per model.
    const aggregateLines = readFileSync(aggregateOut, 'utf-8').split('\n').filter((l) => l.trim() !== '');
    expect(aggregateLines).toHaveLength(2);
    const models = aggregateLines.map((l) => (JSON.parse(l) as { model: string }).model);
    expect(models).toEqual(['test-model-a', 'test-model-b']);
  }, 90000);
});

// ---------- command surface ----------

describe('MetricsCommand (CLI surface)', () => {
  it('registers derive and aggregate subcommands and documents the null tokens/cost', () => {
    const cmd = new MetricsCommand();
    expect(cmd.name()).toBe('metrics');
    const names = cmd.commands.map((c) => c.name());
    expect(names).toEqual(['derive', 'aggregate']);
    const deriveCmd = cmd.commands[0];
    const deriveFlags = deriveCmd.options.map((o: { flags: string }) => o.flags).join(' ');
    expect(deriveFlags).toContain('out');
    expect(deriveCmd.description()).toMatch(/null/); // tokens/cost documented absent
    const aggregateCmd = cmd.commands[1];
    expect(aggregateCmd.description()).toMatch(/table/);
  });
});
