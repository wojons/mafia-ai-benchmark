import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { GameLifecycleReconciler } from '../../services/game-lifecycle-reconciler.js';
import { StatsCollector } from '../../services/stats-collector.js';
import { createGamesRouter } from '../../routes/games.js';
import { createFakeEventBus, createSqliteBackedRepository } from './mocks.js';

describe('GameLifecycleReconciler (DF-MAFIA-AI-BENCHMARK-23-R2)', () => {
  it('retires stale persisted rows but preserves a current in-memory game', () => {
    const repo = createSqliteBackedRepository();
    const now = 2_000_000;
    const staleAt = now - 10_000;
    repo.seedGame({ id: 'stale', status: 'IN_PROGRESS', startedAt: staleAt });
    repo.seedGame({ id: 'live', status: 'IN_PROGRESS', startedAt: staleAt });
    repo.db.prepare(
      'UPDATE games SET created_at = ?, started_at = ? WHERE id IN (?, ?)',
    ).run(staleAt, staleAt, 'stale', 'live');

    const reconciler = new GameLifecycleReconciler(repo, {
      liveGameIds: () => new Set(['live']),
      now: () => now,
      staleAfterMs: 1_000,
    });

    expect(reconciler.reconcile()).toMatchObject({
      inspected: 2,
      retired: 1,
      preservedLive: 1,
    });
    expect(repo.db.prepare('SELECT status FROM games WHERE id = ?').get('stale')).toEqual({
      status: 'CANCELLED',
    });
    expect(repo.db.prepare('SELECT status FROM games WHERE id = ?').get('live')).toEqual({
      status: 'IN_PROGRESS',
    });
  });

  it('uses recent event activity as heartbeat evidence for an unowned row', () => {
    const repo = createSqliteBackedRepository();
    const now = 2_000_000;
    const old = now - 10_000;
    repo.seedGame({
      id: 'event-live',
      status: 'IN_PROGRESS',
      startedAt: old,
      events: [{ type: 'PHASE_CHANGED', phase: 'DAY', data: {} }],
    });
    repo.db.prepare(
      'UPDATE games SET created_at = ?, started_at = ? WHERE id = ?',
    ).run(old, old, 'event-live');
    repo.db.prepare('UPDATE events SET timestamp = ? WHERE game_id = ?').run(now - 100, 'event-live');

    const reconciler = new GameLifecycleReconciler(repo, {
      now: () => now,
      staleAfterMs: 1_000,
    });

    expect(reconciler.reconcile()).toMatchObject({
      inspected: 1,
      retired: 0,
      preservedRecent: 1,
    });
    expect(repo.db.prepare('SELECT status FROM games WHERE id = ?').get('event-live')).toEqual({
      status: 'IN_PROGRESS',
    });
  });

  it('is idempotent after the stale row is retired', () => {
    const repo = createSqliteBackedRepository();
    const now = 2_000_000;
    repo.seedGame({ id: 'stale-once', status: 'IN_PROGRESS', startedAt: now - 10_000 });
    repo.db.prepare(
      'UPDATE games SET created_at = ?, started_at = ? WHERE id = ?',
    ).run(now - 10_000, now - 10_000, 'stale-once');
    const reconciler = new GameLifecycleReconciler(repo, { now: () => now, staleAfterMs: 1_000 });

    expect(reconciler.reconcile().retired).toBe(1);
    expect(reconciler.reconcile()).toMatchObject({ inspected: 0, retired: 0 });
  });

  it('makes stats and the IN_PROGRESS list use one reconciled population', () => {
    const repo = createSqliteBackedRepository();
    const now = 2_000_000;
    repo.seedGame({ id: 'stale', status: 'IN_PROGRESS', startedAt: now - 10_000 });
    repo.seedGame({ id: 'live', status: 'IN_PROGRESS', startedAt: now - 10_000 });
    repo.db.prepare(
      'UPDATE games SET created_at = ?, started_at = ? WHERE id IN (?, ?)',
    ).run(now - 10_000, now - 10_000, 'stale', 'live');
    const reconciler = new GameLifecycleReconciler(repo, {
      liveGameIds: () => new Set(['live']),
      now: () => now,
      staleAfterMs: 1_000,
    });
    const stats = new StatsCollector(repo, reconciler);

    const gameStats = stats.getGameStats();
    const activeRows = repo.listGameSummaries({ status: 'IN_PROGRESS' });

    expect(activeRows.map((row) => row.id)).toEqual(['live']);
    expect(gameStats.activeGames).toBe(activeRows.length);
    expect(gameStats.totalGames).toBe(
      gameStats.activeGames + gameStats.completedGames + gameStats.failedGames,
    );
  });
});

describe('games read reconciliation seam', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  });

  it('retires stale rows when the games list is read without a startup-only dependency', async () => {
    const repo = createSqliteBackedRepository();
    const now = 2_000_000;
    repo.seedGame({ id: 'read-stale', status: 'IN_PROGRESS', startedAt: now - 10_000 });
    repo.db.prepare(
      'UPDATE games SET created_at = ?, started_at = ? WHERE id = ?',
    ).run(now - 10_000, now - 10_000, 'read-stale');
    const lifecycle = new GameLifecycleReconciler(repo, { now: () => now, staleAfterMs: 1_000 });
    const app = express();
    app.use('/', createGamesRouter(
      { gameEngine: {}, gameRepository: repo, eventBus: createFakeEventBus(), gameLifecycle: lifecycle } as any,
      null,
    ));
    server = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const address = server.address() as { port: number };

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/games?status=IN_PROGRESS`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(repo.db.prepare('SELECT status FROM games WHERE id = ?').get('read-stale')).toEqual({
      status: 'CANCELLED',
    });
  });
});
