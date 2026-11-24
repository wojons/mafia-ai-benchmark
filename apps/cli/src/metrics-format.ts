/**
 * Metrics-format — pure derivation of per-player/per-model metrics from the
 * per-run JSONL run-record corpus (MAF-LAYER-2).
 *
 * Every metric is derived ONLY from MAF-LAYER-1 run files (line 1 = RunRecord
 * header, following lines = RunEventLine events in game order) — never from
 * the legacy win-flag-only aggregates (those are hardcoded zeros in the
 * server's stats collector; nothing here reads them).
 *
 * Metric definitions (all mechanically derivable from the event sequence):
 *
 * - survived            — end-of-game aliveness, copied from the run header.
 * - votes_cast          — VOTE_CAST events attributed to the player.
 * - votes_correct       — votes whose target's seat role is MAFIA.
 * - voted_out_incorrect — votes whose target was lynched that same day and
 *                         was NOT mafia (helped vote out an innocent).
 * - majority_follow_rate— of the player's votes on days that ended in a
 *                         lynch, the fraction that targeted the lynched
 *                         player. null when the player voted on no lynch day.
 * - speech_flip_events  — times the player's vote target changed between
 *                         consecutive votes (each vote is a public statement
 *                         with its own think/says). First vote never counts.
 * - night_kill_correct  — actor-attributed night kills by MAFIA/VIGILANTE
 *                         whose target was dead in the following
 *                         MORNING_REVEAL (the kill actually landed).
 * - think_says_lie_rate — over measurable THINK/SAYS speak-turn pairs, the
 *                         fraction whose public statement diverges from the
 *                         private thought (word-level Jaccard similarity
 *                         below LIE_SIMILARITY_THRESHOLD). A pair is the
 *                         public AGENT_SAYS_BROADCASTED of a speak-turn
 *                         together with its private thought: either the
 *                         separate AGENT_THINK_COMPLETED event one turn
 *                         earlier for the same player (the with-THINK era
 *                         shape — criterion 3), or the data.think attached
 *                         to the SAYS event itself (split-pane era). null
 *                         when the player has no measurable pairs.
 * - tokens / cost_usd   — always null: the run corpus records no per-player
 *                         token usage or cost anywhere (verified by grep over
 *                         the whole corpus 2026-11-24). Never invented.
 * - speeches            — AGENT_SAYS_BROADCASTED count (persuasion denom).
 * - followers_gained    — voters who voted the same target as the player's
 *                         own vote on a day where the player also spoke,
 *                         after one of the player's speeches that day
 *                         (persuasion numerator).
 *
 * null always means "not measurable for this player" — never fabricated as 0.
 */

import type {
  MetricValue,
  ModelAggregate,
  RunEventLine,
  RunMetricsRecord,
  RunPlayerMetrics,
  RunRecord,
} from '@mafia/shared/types';

/**
 * A THINK/SAYS pair counts as a lie when the word-level Jaccard similarity
 * between the private thought and the public statement falls below this
 * threshold — the public statement shares under ~20% of its word content
 * with the private thought. Measured over 1,733 real corpus pairs
 * (2026-11-24): jaccard < 0.05 for 0.8%, < 0.1 for 29.8%, < 0.2 for 93.5%,
 * < 0.3 for 99.9% — so this threshold sits just above the distribution's
 * p90 (0.187) and marks "the public statement is not a restatement of the
 * private thought". The constant is load-bearing; change it deliberately.
 */
export const LIE_SIMILARITY_THRESHOLD = 0.2;

/** Metrics with a sample size below this carry the low-sample marker. */
export const LOW_SAMPLE_N = 5;

/** Role whose seats submit night kill actions alongside MAFIA. */
const KILL_ROLES = new Set(['MAFIA', 'VIGILANTE']);

/** Event types the deriver consumes. */
const THINK_COMPLETED = 'AGENT_THINK_COMPLETED';
const SAYS_BROADCASTED = 'AGENT_SAYS_BROADCASTED';
const VOTE_CAST = 'VOTE_CAST';
const PLAYER_LYNCHED = 'PLAYER_LYNCHED';
const NIGHT_ACTION_SUBMITTED = 'NIGHT_ACTION_SUBMITTED';
const MORNING_REVEAL = 'MORNING_REVEAL';

/** Order events in game order (ascending timestamp, ties by metadata.sequence). */
export function orderRunEvents(events: RunEventLine[]): RunEventLine[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      if (a.event.timestamp !== b.event.timestamp) {
        return a.event.timestamp < b.event.timestamp ? -1 : 1;
      }
      const seqA = eventSequence(a.event);
      const seqB = eventSequence(b.event);
      if (seqA !== seqB) return seqA - seqB;
      return a.index - b.index;
    })
    .map(({ event }) => event);
}

function eventSequence(event: RunEventLine): number {
  const seq = (event.metadata as { sequence?: unknown } | null | undefined)?.sequence;
  return typeof seq === 'number' ? seq : Number.MAX_SAFE_INTEGER;
}

function eventDay(event: RunEventLine): number | undefined {
  const day = (event.metadata as { dayNumber?: unknown } | null | undefined)?.dayNumber;
  return typeof day === 'number' ? day : undefined;
}

function eventTurn(event: RunEventLine): number | undefined {
  const turn = (event.metadata as { turnNumber?: unknown } | null | undefined)?.turnNumber;
  return typeof turn === 'number' ? turn : undefined;
}

/** Word-level Jaccard similarity of two texts; null when either side is empty. */
export function wordJaccard(a: string, b: string): number | null {
  const wordsA = tokenize(a);
  const wordsB = tokenize(b);
  if (wordsA.size === 0 || wordsB.size === 0) return null;
  let shared = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) shared += 1;
  }
  return shared / (wordsA.size + wordsB.size - shared);
}

function tokenize(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []));
}

/**
 * Parse one run file body (header line + event lines). Torn event lines are
 * skipped and counted; a torn header line is a hard error (the run is
 * unidentifiable). Returns the header, the events in game order, and the
 * number of skipped (torn) event lines.
 */
export function parseRunFile(body: string, fileName: string): {
  record: RunRecord;
  events: RunEventLine[];
  tornEventLines: number;
} {
  const lines = body.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    throw new Error(`${fileName}: empty run file`);
  }
  let record: RunRecord;
  try {
    const parsed = JSON.parse(lines[0]) as RunRecord;
    if (typeof parsed.game_id !== 'string' || !Array.isArray(parsed.seats)) {
      throw new Error('line 1 is not a run-record header');
    }
    record = parsed;
  } catch (error) {
    throw new Error(`${fileName}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const events: RunEventLine[] = [];
  let tornEventLines = 0;
  for (const line of lines.slice(1)) {
    try {
      events.push(JSON.parse(line) as RunEventLine);
    } catch {
      tornEventLines += 1; // a torn event line never blocks the run's metrics
    }
  }
  return { record, events: orderRunEvents(events), tornEventLines };
}

/** Per-player event accumulators for one run's derivation. */
interface Acc {
  votes: Array<{ target: string; day: number | undefined; order: number }>;
  speeches: Array<{ day: number | undefined; order: number }>;
  nightKillCorrect: number;
  liePairs: number;
  lies: number;
}

/** Derive one run's metrics record from its header + ordered events. */
export function deriveRunMetrics(record: RunRecord, events: RunEventLine[]): RunMetricsRecord {
  const roleByPlayer = new Map<string, string>();
  for (const seat of record.seats) {
    roleByPlayer.set(seat.player_id, seat.role);
  }
  const mafiaPlayers = new Set(
    record.seats.filter((s) => s.role === 'MAFIA').map((s) => s.player_id),
  );

  // Lynch bookkeeping: day -> ids lynched that day.
  const lynchedIdsByDay = new Map<number, string[]>();
  for (const event of events) {
    if (event.type !== PLAYER_LYNCHED) continue;
    const day = eventDay(event);
    if (day === undefined) continue;
    const ids = deathIds(event);
    if (ids.length === 0) continue;
    const existing = lynchedIdsByDay.get(day) ?? [];
    existing.push(...ids);
    lynchedIdsByDay.set(day, existing);
  }
  const lynchDays = new Set(lynchedIdsByDay.keys());

  // Night kills: pending until the next MORNING_REVEAL settles them.
  const pendingKills: Array<{ player_id: string; target: string }> = [];

  // THINK/SAYS turn pairs: (player, speaksTurn) -> private thought /
  // public statement, from the two corpus shapes.
  const thinkByPlayerTurn = new Map<string, string>();
  const attachedThinkByPlayerTurn = new Map<string, string>();
  const saysByPlayerTurn = new Map<string, string>();

  // Per-player accumulators, keyed by player_id (header order).
  const acc = new Map<string, Acc>();
  const accFor = (playerId: string): Acc => {
    let a = acc.get(playerId);
    if (!a) {
      a = { votes: [], speeches: [], nightKillCorrect: 0, liePairs: 0, lies: 0 };
      acc.set(playerId, a);
    }
    return a;
  };

  events.forEach((event, order) => {
    const playerId = eventActorId(event);
    switch (event.type) {
      case VOTE_CAST: {
        if (!playerId) break;
        const target = stringField(event, 'targetId');
        accFor(playerId).votes.push({ target: target ?? '', day: eventDay(event), order });
        break;
      }
      case SAYS_BROADCASTED: {
        if (!playerId) break;
        accFor(playerId).speeches.push({ day: eventDay(event), order });
        const says = stringField(event, 'says');
        const turn = eventTurn(event);
        if (says !== null && turn !== undefined) {
          saysByPlayerTurn.set(`${playerId}|${turn}`, says);
          // The split-pane era attaches the private thought to the SAYS
          // event itself; used only when no separate THINK event exists.
          const attachedThink = stringField(event, 'think');
          if (attachedThink !== null) {
            attachedThinkByPlayerTurn.set(`${playerId}|${turn}`, attachedThink);
          }
        }
        break;
      }
      case THINK_COMPLETED: {
        // The private thought is attributed by data.playerId when present,
        // falling back to actor_id (both identify the thinking agent).
        const thinker = stringField(event, 'playerId') ?? playerId;
        const think = stringField(event, 'think');
        const turn = eventTurn(event);
        if (thinker && think !== null && turn !== undefined) {
          thinkByPlayerTurn.set(`${thinker}|${turn}`, think);
        }
        break;
      }
      case PLAYER_LYNCHED:
        break; // consumed via lynchedIdsByDay above
      case NIGHT_ACTION_SUBMITTED: {
        // Night actions without actor_id (mafia group decisions) are not
        // attributable to a player and are skipped — never guessed.
        const target = stringField(event, 'targetId');
        if (!playerId || target === null) break;
        if (!KILL_ROLES.has(roleByPlayer.get(playerId) ?? '')) break;
        pendingKills.push({ player_id: playerId, target });
        break;
      }
      case MORNING_REVEAL: {
        const dead = new Set(deathIds(event));
        for (const kill of pendingKills) {
          if (dead.has(kill.target)) {
            accFor(kill.player_id).nightKillCorrect += 1;
          }
        }
        pendingKills.length = 0;
        break;
      }
      default:
        break; // GAME_CREATED/STARTED/ENDED, ROLES_ASSIGNED, PHASE_CHANGED, ...
    }
  });

  // THINK/SAYS lie measurement (criterion 3): pair the private THINK event
  // with the public SAYS statement of the same speak-turn. The corpus
  // records two shapes (verified over the real corpus 2026-11-24): the
  // with-THINK era emits a private AGENT_THINK_COMPLETED at turn N and the
  // public AGENT_SAYS_BROADCASTED at turn N+1 for the same player (the
  // SAYS event's own data.think is null there); the split-pane era attaches
  // both texts to the SAYS event. Pair per speak-turn: THINK event at T-1
  // wins (criterion 3's private event), else the SAYS's own data.think.
  for (const [key, says] of saysByPlayerTurn) {
    const sep = key.lastIndexOf('|');
    const playerId = key.slice(0, sep);
    const turn = Number(key.slice(sep + 1));
    const think =
      thinkByPlayerTurn.get(`${playerId}|${turn - 1}`) ??
      attachedThinkByPlayerTurn.get(key);
    if (think === undefined) continue; // no private thought for this speak-turn
    const similarity = wordJaccard(think, says);
    if (similarity === null) continue; // an empty side is unmeasurable
    const a = accFor(playerId);
    a.liePairs += 1;
    if (similarity < LIE_SIMILARITY_THRESHOLD) a.lies += 1;
  }

  const perPlayer: RunPlayerMetrics[] = record.seats.map((seat) => {
    const a = acc.get(seat.player_id) ?? {
      votes: [], speeches: [], nightKillCorrect: 0, liePairs: 0, lies: 0,
    };

    const votesCorrect = a.votes.filter((v) => mafiaPlayers.has(v.target)).length;
    const votedOutIncorrect = a.votes.filter((v) => {
      if (v.day === undefined) return false;
      const lynched = lynchedIdsByDay.get(v.day);
      if (!lynched || !lynched.includes(v.target)) return false;
      return roleByPlayer.get(v.target) !== 'MAFIA';
    }).length;
    const lynchDayVotes = a.votes.filter((v) => v.day !== undefined && lynchDays.has(v.day));
    const majorityFollows = lynchDayVotes.filter((v) => {
      return (lynchedIdsByDay.get(v.day as number) ?? []).includes(v.target);
    }).length;

    let speechFlips = 0;
    for (let i = 1; i < a.votes.length; i += 1) {
      if (a.votes[i].target !== a.votes[i - 1].target) speechFlips += 1;
    }

    const followersGained = countFollowers(seat.player_id, a, record.seats.map((s) => s.player_id), acc);

    return {
      player_id: seat.player_id,
      provider: seat.provider,
      model: seat.model,
      role: seat.role,
      won: seat.won,
      survived: seat.survived,
      votes_cast: a.votes.length,
      votes_correct: votesCorrect,
      voted_out_incorrect: votedOutIncorrect,
      majority_follow_rate: lynchDayVotes.length > 0 ? majorityFollows / lynchDayVotes.length : null,
      speech_flip_events: speechFlips,
      night_kill_correct: a.nightKillCorrect,
      think_says_lie_rate: a.liePairs > 0 ? a.lies / a.liePairs : null,
      tokens: null, // corpus records no per-player token usage (grep-verified)
      cost_usd: null, // corpus records no per-player cost (grep-verified)
      speeches: a.speeches.length,
      followers_gained: followersGained,
      think_says_pairs: a.liePairs,
      think_says_lies: a.lies,
    };
  });

  return { game_id: record.game_id, per_player: perPlayer };
}

/**
 * Followers gained by one player: for each day where the player both spoke
 * (>=1 SAYS_BROADCASTED) and voted, count the OTHER players whose day vote
 * targeted the same player, cast after one of the player's speeches that day.
 */
function countFollowers(
  playerId: string,
  own: Acc,
  allPlayers: string[],
  acc: Map<string, Acc>,
): number {
  const speechDays = new Set(
    own.speeches.filter((s) => s.day !== undefined).map((s) => s.day as number),
  );
  let followers = 0;
  for (const day of speechDays) {
    const ownVote = own.votes.find((v) => v.day === day);
    if (!ownVote) continue; // spoke but never voted that day
    const ownSpeechOrders = own.speeches
      .filter((s) => s.day === day)
      .map((s) => s.order);
    for (const otherId of allPlayers) {
      if (otherId === playerId) continue;
      const other = acc.get(otherId);
      if (!other) continue;
      const followed = other.votes.some(
        (v) =>
          v.day === day &&
          v.target === ownVote.target &&
          ownSpeechOrders.some((speechOrder) => speechOrder < v.order),
      );
      if (followed) followers += 1;
    }
  }
  return followers;
}

function eventActorId(event: RunEventLine): string | null {
  return event.actor_id;
}

function stringField(event: RunEventLine, key: string): string | null {
  const value = (event.data as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' ? value : null;
}

/** Player ids that died in a PLAYER_LYNCHED / MORNING_REVEAL event. */
function deathIds(event: RunEventLine): string[] {
  const deaths = (event.data as { deaths?: unknown } | null | undefined)?.deaths;
  if (!Array.isArray(deaths)) return [];
  return deaths
    .map((d) => (typeof (d as { id?: unknown })?.id === 'string' ? (d as { id: string }).id : null))
    .filter((id): id is string => id !== null);
}

/** Serialize one run's metrics record as its single JSONL line. */
export function serializeMetricsLine(record: RunMetricsRecord): string {
  return JSON.stringify(record) + '\n';
}

/** Aggregate per-player metrics records into per-model rows. */
export function aggregateModels(records: RunMetricsRecord[]): ModelAggregate[] {
  interface Seat {
    won: number | null;
    survived: boolean;
    role: string;
    votes_cast: number;
    votes_correct: number;
    speeches: number;
    followers_gained: number;
    lie_pairs: number;
    lies: number;
    game_id: string;
  }
  const byModel = new Map<string, Seat[]>();
  for (const record of records) {
    for (const player of record.per_player) {
      if (!player.model) {
        continue; // unattributed seats are never ranked as a model
      }
      const rows = byModel.get(player.model) ?? [];
      rows.push({
        won: player.won,
        survived: player.survived,
        role: player.role,
        votes_cast: player.votes_cast,
        votes_correct: player.votes_correct,
        speeches: player.speeches,
        followers_gained: player.followers_gained,
        lie_pairs: player.think_says_pairs,
        lies: player.think_says_lies,
        game_id: record.game_id,
      });
      byModel.set(player.model, rows);
    }
  }

  const aggregates: ModelAggregate[] = [];
  for (const model of [...byModel.keys()].sort()) {
    const seats = byModel.get(model) as Seat[];
    const decided = seats.filter((s) => s.won !== null);
    const games = new Set(seats.map((s) => s.game_id)).size;

    const survivalByRole: Record<string, MetricValue> = {};
    const roles = [...new Set(seats.map((s) => s.role))].sort((a, b) => {
      if (a === 'MAFIA') return -1; // mafia first, then alphabetical
      if (b === 'MAFIA') return 1;
      return a < b ? -1 : 1;
    });
    for (const role of roles) {
      const roleSeats = seats.filter((s) => s.role === role);
      survivalByRole[role] = metric(
        roleSeats.filter((s) => s.survived).length,
        roleSeats.length,
      );
    }

    const votesCast = seats.reduce((sum, s) => sum + s.votes_cast, 0);
    const votesCorrect = seats.reduce((sum, s) => sum + s.votes_correct, 0);
    const speeches = seats.reduce((sum, s) => sum + s.speeches, 0);
    const followers = seats.reduce((sum, s) => sum + s.followers_gained, 0);
    const liePairs = seats.reduce((sum, s) => sum + s.lie_pairs, 0);
    const lies = seats.reduce((sum, s) => sum + s.lies, 0);

    aggregates.push({
      model,
      games_played: games,
      win_rate: metric(decided.filter((s) => s.won === 1).length, decided.length),
      survival: metric(seats.filter((s) => s.survived).length, seats.length),
      survival_by_role: survivalByRole,
      vote_accuracy: metric(votesCorrect, votesCast),
      persuasion: metric(followers, speeches),
      lie_rate: metric(lies, liePairs),
    });
  }
  return aggregates;
}

/**
 * Count seats whose metrics carry no model attribution (the deriver copies
 * the run header's null through). The command layer reports this count on
 * stderr; the aggregator never ranks unattributed seats as a model.
 */
export function countUnattributedSeats(records: RunMetricsRecord[]): number {
  return records.reduce(
    (sum, record) => sum + record.per_player.filter((p) => !p.model).length,
    0,
  );
}

function metric(numerator: number, denominator: number): MetricValue {
  return {
    value: denominator > 0 ? numerator / denominator : null,
    n: denominator,
    low_sample: denominator < LOW_SAMPLE_N,
  };
}

function formatMetricCell(value: MetricValue): string {
  const rendered = value.value === null ? 'n/a' : value.value.toFixed(3);
  return `${rendered} (n=${value.n})${value.low_sample ? '*' : ''}`;
}

/** Render one aligned text table from string rows (row 0 = header). */
function renderAlignedTable(rows: string[][]): string {
  const widthByCol: number[] = [];
  for (const row of rows) {
    row.forEach((cell, col) => {
      widthByCol[col] = Math.max(widthByCol[col] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) => row
      .map((cell, col) => (col === 0 ? cell.padEnd(widthByCol[col]) : cell.padStart(widthByCol[col])))
      .join('  '))
    .join('\n');
}

/**
 * Render the per-model table: one row per model (win_rate, survival,
 * vote_accuracy, persuasion, lie_rate — each with its sample n and the
 * low-sample marker), followed by the survival-by-role breakout. Pure text
 * (no chalk) so the render is directly testable.
 */
export function renderModelTable(aggregates: ModelAggregate[]): string {
  if (aggregates.length === 0) {
    return 'No attributed model seats found in the metrics corpus.';
  }
  const mainRows: string[][] = [
    ['model', 'games', 'win_rate', 'survival', 'vote_accuracy', 'persuasion', 'lie_rate'],
    ...aggregates.map((a) => [
      a.model,
      String(a.games_played),
      formatMetricCell(a.win_rate),
      formatMetricCell(a.survival),
      formatMetricCell(a.vote_accuracy),
      formatMetricCell(a.persuasion),
      formatMetricCell(a.lie_rate),
    ]),
  ];

  // Role breakout: union of roles in the aggregator's order (MAFIA first).
  const roleOrder: string[] = [];
  for (const aggregate of aggregates) {
    for (const role of Object.keys(aggregate.survival_by_role)) {
      if (!roleOrder.includes(role)) roleOrder.push(role);
    }
  }
  const roleRows: string[][] = [
    ['model', ...roleOrder],
    ...aggregates.map((a) => [
      a.model,
      ...roleOrder.map((role) => {
        const value = a.survival_by_role[role];
        return value ? formatMetricCell(value) : 'n/a (n=0)';
      }),
    ]),
  ];

  return [
    renderAlignedTable(mainRows),
    '* low sample (n < 5)',
    '',
    'survival by role:',
    renderAlignedTable(roleRows),
    '* low sample (n < 5)',
  ].join('\n');
}
