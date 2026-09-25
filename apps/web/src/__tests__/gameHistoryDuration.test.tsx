import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import GameHistoryTable, {
  computeGameDuration,
  formatDuration,
  type GameHistoryRow,
} from '../components/GameHistoryTable';

// DF-MAFIA-AI-BENCHMARK-14: ended games carry createdAt + endedAt ISO strings
// (startedAt/gameOverAt are null on ended rows — they are never the duration
// source). Duration = endedAt - createdAt; '—' only when endedAt is absent.
const ENDED_WITH_DATES = {
  id: 'game-0001-abcd',
  status: 'ENDED',
  players: 6,
  createdAt: '2026-09-25T20:00:00.000Z',
  endedAt: '2026-09-25T20:14:30.000Z',
  config: { winner: 'Town' },
};

const ENDED_WITHOUT_END = {
  id: 'game-0002-abcd',
  status: 'ENDED',
  players: 6,
  createdAt: '2026-09-25T20:00:00.000Z',
  endedAt: null,
  config: { winner: 'Mafia' },
};

function renderRows(games: unknown[]): string {
  return renderToString(
    <GameHistoryTable
      games={games as never}
      loading={false}
    />,
  );
}

describe('computeGameDuration', () => {
  it('computes endedAt - createdAt and formats as minutes + seconds', () => {
    expect(computeGameDuration(ENDED_WITH_DATES.createdAt, ENDED_WITH_DATES.endedAt)).toBe('14m 30s');
  });

  it('returns an em-dash when endedAt is absent', () => {
    expect(computeGameDuration(ENDED_WITHOUT_END.createdAt, ENDED_WITHOUT_END.endedAt)).toBe('\u2014');
  });

  it('returns an em-dash when createdAt is missing or timestamps are unparsable', () => {
    expect(computeGameDuration(undefined, '2026-09-25T20:14:30.000Z')).toBe('\u2014');
    expect(computeGameDuration('not-a-date', '2026-09-25T20:14:30.000Z')).toBe('\u2014');
    expect(computeGameDuration('2026-09-25T20:00:00.000Z', '')).toBe('\u2014');
  });

  it('formatDuration keeps the existing "Xm Ys" format and dashes non-positive values', () => {
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(0)).toBe('\u2014');
    expect(formatDuration(-5)).toBe('\u2014');
  });
});

describe('GameHistoryTable duration cells', () => {
  it('renders a computed duration when endedAt exists', () => {
    const html = renderRows([ENDED_WITH_DATES]);
    expect(html).toContain('14m 30s');
    expect(html).not.toContain('data-tombstone');
  });

  it('renders an em-dash when endedAt is genuinely absent', () => {
    const html = renderRows([ENDED_WITHOUT_END]);
    expect(html).toContain('\u2014');
    expect(html).not.toContain('14m 30s');
  });

  it('renders mixed rows with per-row durations, never placeholder dashes for computable games', () => {
    const html = renderRows([ENDED_WITH_DATES, ENDED_WITHOUT_END]);
    expect(html).toContain('14m 30s');
    expect(html).toContain('\u2014');
  });
});