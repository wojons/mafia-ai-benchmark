/**
 * Malformed JSON body → 400 (DF-MAFIA-AI-BENCHMARK-5 sub-task A).
 *
 * Express body-parser emits an `entity.parse.failed` error when a request
 * with Content-Type: application/json carries a syntactically invalid body.
 * Before this fix there was no body-parse error handler, so the generic
 * error middleware answered 500 INTERNAL_ERROR. A malformed client payload
 * is a client error: the server must answer HTTP 400 with the standard
 * { success, error: { code, message } } envelope.
 *
 * Mounts an Express app with the SAME middleware stack as src/index.ts
 * (helmet/cors/compression/json/urlencoded + the routes) on an ephemeral
 * listen(0) port and drives it with Node's built-in fetch — same pattern
 * as services/games-routes.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { createGamesRouter } from '../../routes/games.js';
import { bodyParseErrorHandler } from '../../middleware/body-parse-error.js';
import { createSqliteBackedRepository, createFakeEventBus } from './mocks.js';
import type { LegacyGameAdapter } from '../services/legacy-game-adapter.js';

describe('malformed JSON body handling (DF-MAFIA-AI-BENCHMARK-5)', () => {
  let repo: ReturnType<typeof createSqliteBackedRepository>;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    repo = createSqliteBackedRepository() as unknown as ReturnType<typeof createSqliteBackedRepository>;

    // Mirror src/index.ts middleware order: json + urlencoded body parsing,
    // then the routes, then the production body-parse error handler, then
    // the generic error handler. Before the fix the parse error fell through
    // to the generic 500 handler — the exact live-observed behavior
    // (curl → 500 INTERNAL_ERROR).
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(
      '/',
      createGamesRouter(
        { gameEngine: {}, gameRepository: repo, eventBus: createFakeEventBus() } as any,
        {
          getActiveGames: () => [],
          getGameState: () => undefined,
          // POST /api/v1/games routes through the legacy adapter when one is
          // present; return a minimal state so the happy path reaches 201.
          startGame: () => ({ gameId: 'g-legacy-happy', status: 'RUNNING' }),
        } as unknown as LegacyGameAdapter,
      ),
    );
    // The production handler under test (imported, not re-implemented).
    app.use(bodyParseErrorHandler());
    // Same generic handler as src/index.ts (the 500 path).
    app.use(
      (
        err: Error,
        _req: express.Request,
        res: express.Response,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _next: express.NextFunction,
      ) => {
        res.status(500).json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: err.message,
          },
        });
      },
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('answers 400 BAD_REQUEST with the error envelope for a malformed JSON body on POST /api/v1/games', async () => {
    const response = await fetch(`${baseUrl}/api/v1/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it('still parses valid JSON bodies normally (no regression on the happy path)', async () => {
    const response = await fetch(`${baseUrl}/api/v1/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numPlayers: 5 }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });
});