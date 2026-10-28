// ch:trace row=DF-MAFIA-AI-BENCHMARK-23-R3 spec=none:bugfix-reconciler wave=mafia-ai-benchmark-foreman-2026-10-28-10-22-22.json#DF-MAFIA-AI-BENCHMARK-23-R3 test=apps/server/src/__tests__/services/game-lifecycle-never-started.test.ts::retires a never-started IN_PROGRESS ghost with no live engine and no players evidence=commit commit=none:pending-foreman-trace
import { describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { GameLifecycleReconciler } from '../../services/game-lifecycle-reconciler.js';
import { createGamesRouter } from '../../routes/games.js';
import { createFakeEventBus, createSqliteBackedRepository } from './mocks.js';

/**
 * DF-MAFIA-AI-BENCHMARK-23-R3: never-started games were preserved as
 * "recent" by age alone and served as live. A persisted IN_PROGRESS row
 * with started_at NULL and zero player rows has no owner that can ever
 * come back (no engine bridge can adopt a game that never began), so the
 * reconciler must retire it immediately instead of waiting out the stale
 * age window.
 */
describe('GameLifecycleReconciler never-started ghosts (DF-MAFIA-AI-BENCHMARK-23-R3)', () => {
  it('retires a never-started IN_PROGRESS ghost with no live engine and zero players', () => {
    const repo = createSqliteBackedRepository();
    const now = 2_000_000;
    repo.seedGame({
      id: 'ghost',
      status: 'IN_PROGRESS',
      events: [{ type: 'GAME_CREATED', data: {} }],
    });
    // The seed helper stamps started_at = now; the ghost shape is
    // started_at NULL. Overwrite it to reproduce the measured defect:
    // IN_PROGRESS, started_at NULL, zero player rows, ~8 events.
    repo.db.prepare('UPDATE games SET started_at = NULL WHERE id = ?').run('ghost');

    const reconciler = new GameLifecycleReconciler(repo, {
      liveGameIds: () => new Set<string>(),
      now: () => now,
      staleAfterMs: 24 * 60 * 60 * 1000,
    });

    expect(reconciler.reconcile()).toMatchObject({
      inspected: 1,
      retired: 1,
      retiredNeverStarted: 1,
      preservedLive: 0,
      preservedRecent: 0,
    });
    expect(repo.db.prepare('SELECT status, ended_at FROM games WHERE id = ?').get('ghost'))
      .toMatchObject({ status: 'CANCELLED' });
    expect(
      repo.db.prepare('SELECT ended_at FROM games WHERE id = ?').get('ghost')!.ended_at,
    ).not.toBeNull();

    // The reason must be recorded in the event log, matching how the
    // existing cancel paths stamp terminal evidence.
    const cancelEvent = repo.db
      .prepare("SELECT type, data FROM events WHERE game_id = ? AND type = 'GAME_CANCELLED'")
      .get('ghost') as { type: string; data: string } | undefined;
    expect(cancelEvent).toBeDefined();
    expect(JSON.parse(cancelEvent!.data)).toMatchObject({ reason: expect.any(String) });
  });

  it('keeps an engine-owned never-started game on the preservedLive path', () => {
    const repo = createSqliteBackedRepository();
    const now = 2_000_000;
    repo.seedGame({ id: 'freshly-created', status: 'IN_PROGRESS' });
    repo.db.prepare('UPDATE games SET started_at = NULL WHERE id = ?').run('freshly-created');

    const reconciler = new GameLifecycleReconciler(repo, {
      liveGameIds: () => new Set(['freshly-created']),
      now: () => now,
    });

    expect(reconciler.reconcile()).toMatchObject({
      inspected: 1,
      retired: 0,
      preservedLive: 1,
    });
    expect(repo.db.prepare('SELECT status FROM games WHERE id = ?').get('freshly-created'))
      .toEqual({ status: 'IN_PROGRESS' });
  });

  it('does not regress started rows with evidence (recent stays preserved)', () => {
    const repo = createSqliteBackedRepository();
    const now = 2_000_000;
    repo.seedGame({
      id: 'started-recent',
      status: 'IN_PROGRESS',
      startedAt: now - 1_000,
      players: [{ id: 'p1', name: 'P1', role: 'VILLAGER', joinOrder: 1 }],
      events: [{ type: 'PHASE_CHANGED', phase: 'DAY', data: {} }],
    });

    const reconciler = new GameLifecycleReconciler(repo, {
      liveGameIds: () => new Set<string>(),
      now: () => now,
      staleAfterMs: 24 * 60 * 60 * 1000,
    });

    expect(reconciler.reconcile()).toMatchObject({
      inspected: 1,
      retired: 0,
      retiredNeverStarted: 0,
      preservedRecent: 1,
    });
    expect(repo.db.prepare('SELECT status FROM games WHERE id = ?').get('started-recent'))
      .toEqual({ status: 'IN_PROGRESS' });
  });

  it('stops serving a ghost row on the IN_PROGRESS read surface', async () => {
    const repo = createSqliteBackedRepository();
    const now = 2_000_000;
    repo.seedGame({ id: 'ghost-read', status: 'IN_PROGRESS' });
    repo.db.prepare('UPDATE games SET started_at = NULL WHERE id = ?').run('ghost-read');

    const lifecycle = new GameLifecycleReconciler(repo, {
      liveGameIds: () => new Set<string>(),
      now: () => now,
    });
    const app = express();
    app.use('/', createGamesRouter(
      { gameEngine: {}, gameRepository: repo, eventBus: createFakeEventBus(), gameLifecycle: lifecycle } as any,
      null,
    ));
    const server = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const address = server.address() as { port: number };
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/v1/games?status=IN_PROGRESS&limit=1000`,
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual([]);
      expect(repo.db.prepare('SELECT status FROM games WHERE id = ?').get('ghost-read'))
        .toEqual({ status: 'CANCELLED' });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});