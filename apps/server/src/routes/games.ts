/**
 * Game CRUD routes.
 *
 * Extracted from the monolithic routes/index.ts to reduce file size.
 */

import { Router, Request, Response } from 'express';
import { ServerContext } from '../index.js';
import { LegacyGameAdapter } from '../services/legacy-game-adapter.js';
import type { Player } from '@mafia/shared/types';

// Store for SSE connections per game (shared across game routes)
const gameSSESubscriptions: Map<string, Set<Response>> = new Map();

/**
 * Normalize a player extracted from the event stream into the API player
 * shape. The extractor only reports role/isMafia/isAlive when the events
 * actually revealed them; neutral defaults are applied otherwise.
 */
function toApiPlayer(p: {
  id: string;
  name: string;
  role: string;
  isMafia: boolean;
  isAlive: boolean;
  joinOrder: number;
}): Player {
  return {
    id: p.id,
    name: p.name,
    role: p.role as Player['role'],
    isAlive: p.isAlive,
    isMafia: p.isMafia,
    joinOrder: p.joinOrder,
  };
}

export function createGamesRouter(
  context: ServerContext,
  legacyAdapter: LegacyGameAdapter | null,
): Router {
  const { gameEngine, gameRepository, eventBus } = context;
  const router = Router();

  // ==================== GAME REPLAY & EVENTS ====================

  // Get game events (REST JSON) with optional visibility filter
  // When Accept: text/event-stream, acts as SSE streaming endpoint
  router.get('/api/v1/games/:gameId/events', (req: Request, res: Response) => {
    const { gameId } = req.params;
    const wantsSSE = req.headers.accept?.includes('text/event-stream');

    if (wantsSSE) {
      // ===== SSE STREAMING =====
      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      // Send initial connection event
      res.write(
        `data: ${JSON.stringify({ type: 'connected', gameId, timestamp: new Date().toISOString() })}\n\n`,
      );

      // Add to subscriptions
      if (!gameSSESubscriptions.has(gameId)) {
        gameSSESubscriptions.set(gameId, new Set());
      }
      gameSSESubscriptions.get(gameId)!.add(res);

      console.log(`📡 SSE client connected to game ${gameId}`);

      // Subscribe to event bus for this game (wildcard)
      const unsubscribe = eventBus.subscribeAll(
        (event: any) => {
          if (event.gameId === gameId) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          }
        },
        { filter: (event: any) => event.gameId === gameId },
      );

      // Handle client disconnect
      req.on('close', () => {
        unsubscribe();
        gameSSESubscriptions.get(gameId)?.delete(res);
        if (gameSSESubscriptions.get(gameId)?.size === 0) {
          gameSSESubscriptions.delete(gameId);
        }
        console.log(`📡 SSE client disconnected from game ${gameId}`);
      });

      // Keep connection alive
      const keepAlive = setInterval(() => {
        res.write(`: keepalive\n\n`);
      }, 30000);

      req.on('close', () => {
        clearInterval(keepAlive);
      });
      return;
    }

    // ===== REST JSON EVENTS =====
    const visibility = (req.query.visibility as string) || 'all';

    try {
      // Check if game exists (both repository and legacy)
      const game = gameRepository.getGame(gameId);
      let legacyExists = false;

      if (!game && legacyAdapter) {
        const state = legacyAdapter.getGameState(gameId);
        legacyExists = !!state;
      }

      if (!game && !legacyExists) {
        return res.status(404).json({ success: false, error: 'Game not found' });
      }

      // Get events
      let events = gameRepository.getEvents(gameId);

      // Apply visibility filter
      if (visibility === 'public') {
        events = events.filter((e) => e.visibility === 'PUBLIC');
      } else if (visibility === 'private') {
        events = events.filter((e) => e.visibility === 'PRIVATE');
      }
      // 'all' — no filter

      res.json({
        success: true,
        data: events,
        count: events.length,
      });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, error: 'Failed to get events' });
    }
  });

  // Get full game replay timeline sorted chronologically
  router.get('/api/v1/games/:gameId/replay', (req: Request, res: Response) => {
    const { gameId } = req.params;

    try {
      // Check if game exists (both repository and legacy)
      const game = gameRepository.getGame(gameId);
      let legacyExists = false;

      if (!game && legacyAdapter) {
        const state = legacyAdapter.getGameState(gameId);
        legacyExists = !!state;
      }

      if (!game && !legacyExists) {
        return res.status(404).json({ success: false, error: 'Game not found' });
      }

      // Get all events and sort chronologically
      const events = gameRepository.getEvents(gameId);
      const timeline = events.sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
      );

      res.json({
        success: true,
        data: timeline,
        count: timeline.length,
      });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, error: 'Failed to get replay' });
    }
  });

  // ==================== SSE EVENT STREAMING ====================

  // Get list of active SSE connections
  router.get(
    '/api/v1/games/:gameId/sse-status',
    (req: Request, res: Response) => {
      const { gameId } = req.params;
      const subscribers = gameSSESubscriptions.get(gameId)?.size || 0;

      res.json({
        success: true,
        data: {
          gameId,
          activeConnections: subscribers,
          isStreaming: subscribers > 0,
        },
      });
    },
  );

  // ==================== GAMES ====================

  // List games
  router.get('/api/v1/games', (req: Request, res: Response) => {
    try {
      const filters = {
        status: req.query.status as 'SETUP' | 'IN_PROGRESS' | 'ENDED' | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };

      const games = gameRepository.listGames(filters);

      // Also include legacy games if adapter is available
      const legacyGames: any[] = [];
      if (legacyAdapter) {
        for (const gameId of legacyAdapter.getActiveGames()) {
          const state = legacyAdapter.getGameState(gameId);
          if (state) {
            const events = gameRepository.getEvents(gameId);
            const playerSet = new Set<string>();
            for (const event of events) {
              if (event.actorId) playerSet.add(event.actorId);
            }
            legacyGames.push({
              id: gameId,
              status: state.status === 'RUNNING' ? 'IN_PROGRESS' : 'ENDED',
              players: playerSet.size,
              createdAt: state.startedAt.toISOString(),
              config: { engineType: 'legacy' },
            });
          }
        }
      }

      const allGames = [
        ...games.map((g) => {
          let playerCount = g.players.length;
          if (playerCount === 0 && g.events.length > 0) {
            const actorIds = new Set<string>();
            for (const event of g.events) {
              if (event.actorId) actorIds.add(event.actorId);
            }
            playerCount = actorIds.size;
          }
          return {
            id: g.id,
            status: g.status,
            players: playerCount,
            createdAt: g.createdAt,
            config: g.config,
          };
        }),
        ...legacyGames,
      ];

      // MAF-GAP-013: the repository honors limit only for DB rows; legacy
      // games are appended after, so the merged result must be sliced here
      // for the limit to be enforced on the full response.
      const limitedGames = allGames.slice(0, filters.limit);

      res.json({
        success: true,
        data: limitedGames,
        count: limitedGames.length,
      });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, error: 'Failed to list games' });
    }
  });

  // Create game - always uses legacy engine when available, fallback to standard
  router.post('/api/v1/games', (req: Request, res: Response) => {
    try {
      const {
        config,
        hostName,
        numPlayers,
        personaSeeds,
        legacyConfig,
        models,
        roleModels,
      } = req.body;

      // Extract roleModels from multiple possible sources
      const resolvedRoleModels =
        roleModels || config?.roleModels || req.body.roleModels || models;

      if (legacyAdapter) {
        // Use legacy game engine (default path — runs real LLM-powered games)
        try {
          const gameState = legacyAdapter.startGame({
            numPlayers: numPlayers || 5,
            personaSeeds,
            gameConfig: legacyConfig || config,
            roleModels: resolvedRoleModels,
          });

          res.status(201).json({
            success: true,
            data: {
              gameId: gameState.gameId,
              status: 'starting',
              config: {
                engineType: 'legacy',
                numPlayers: numPlayers || 5,
              },
            },
          });
        } catch (error) {
          res.status(500).json({
            success: false,
            error:
              'Failed to start legacy game: ' + (error as Error).message,
          });
        }
        return;
      }

      // Fallback: standard game creation (no legacy engine available)
      const game = gameEngine.createGame({
        config: req.body.config,
        hostName: req.body.hostName,
      });

      res.status(201).json({
        success: true,
        data: {
          gameId: game.id,
          status: game.status,
          config: game.config,
        },
      });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, error: 'Failed to create game' });
    }
  });

  // Get game
  router.get('/api/v1/games/:gameId', (req: Request, res: Response) => {
    try {
      const game = gameRepository.getGame(req.params.gameId);

      if (!game) {
        // Check legacy games
        if (legacyAdapter) {
          const state = legacyAdapter.getGameState(req.params.gameId);
          if (state) {
            const events = gameRepository.getEvents(req.params.gameId);
            const players =
              LegacyGameAdapter.extractPlayersFromEvents(events).map(toApiPlayer);

            return res.json({
              success: true,
              data: {
                id: state.gameId,
                status:
                  state.status === 'RUNNING' ? 'IN_PROGRESS' : 'ENDED',
                config: { engineType: 'legacy' },
                eventCount: state.eventCount,
                startedAt: state.startedAt,
                players,
              },
            });
          }
        }
        return res
          .status(404)
          .json({ success: false, error: 'Game not found' });
      }

      if (game.players.length === 0 && game.events.length > 0) {
        game.players =
          LegacyGameAdapter.extractPlayersFromEvents(game.events).map(toApiPlayer);
      }

      res.json({
        success: true,
        data: game,
      });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, error: 'Failed to get game' });
    }
  });

  // Join game
  router.post(
    '/api/v1/games/:gameId/join',
    (req: Request, res: Response) => {
      try {
        const { playerName, agentConfig } = req.body;
        const result = gameEngine.joinGame(
          req.params.gameId,
          playerName,
          agentConfig,
        );

        if (!result.success) {
          return res
            .status(400)
            .json({ success: false, error: result.error });
        }

        res.status(201).json({
          success: true,
          data: { eventId: result.event?.id },
        });
      } catch (error) {
        res
          .status(500)
          .json({ success: false, error: 'Failed to join game' });
      }
    },
  );

  // Start game
  router.post(
    '/api/v1/games/:gameId/start',
    (req: Request, res: Response) => {
      try {
        const result = gameEngine.startGame(req.params.gameId);

        if (!result.success) {
          return res
            .status(400)
            .json({ success: false, error: result.error });
        }

        res.json({
          success: true,
          data: { eventId: result.event?.id },
        });
      } catch (error) {
        res
          .status(500)
          .json({ success: false, error: 'Failed to start game' });
      }
    },
  );

  // Get game state
  router.get(
    '/api/v1/games/:gameId/state',
    (req: Request, res: Response) => {
      try {
        const state = gameEngine.getGameState(req.params.gameId);

        if (!state) {
          return res
            .status(404)
            .json({ success: false, error: 'Game not found' });
        }

        res.json({
          success: true,
          data: state,
        });
      } catch (error) {
        res
          .status(500)
          .json({ success: false, error: 'Failed to get game state' });
      }
    },
  );

  // ==================== LEGACY ENGINE ENDPOINTS ====================

  // List active legacy games
  router.get('/api/v1/legacy-games', (req: Request, res: Response) => {
    if (!legacyAdapter) {
      return res
        .status(503)
        .json({ success: false, error: 'Legacy engine not available' });
    }

    const activeGames = legacyAdapter.getActiveGames().map((gameId) => {
      const state = legacyAdapter.getGameState(gameId);
      return {
        gameId,
        status: state?.status,
        eventCount: state?.eventCount,
        startedAt: state?.startedAt,
        error: state?.error,
      };
    });

    res.json({ success: true, data: activeGames });
  });

  // Stop a legacy game
  router.post(
    '/api/v1/legacy-games/:gameId/stop',
    (req: Request, res: Response) => {
      if (!legacyAdapter) {
        return res
          .status(503)
          .json({ success: false, error: 'Legacy engine not available' });
      }

      const stopped = legacyAdapter.stopGame(req.params.gameId);
      res.json({
        success: stopped,
        data: { gameId: req.params.gameId, stopped },
      });
    },
  );

  // Submit night action
  router.post(
    '/api/v1/games/:gameId/night-action',
    (req: Request, res: Response) => {
      try {
        const { playerId, action, targetId } = req.body;
        const result = gameEngine.submitNightAction(
          req.params.gameId,
          playerId,
          action,
          targetId,
        );

        if (!result.success) {
          return res
            .status(400)
            .json({ success: false, error: result.error });
        }

        res.json({
          success: true,
          data: { eventId: result.event?.id },
        });
      } catch (error) {
        res
          .status(500)
          .json({ success: false, error: 'Failed to submit night action' });
      }
    },
  );

  // Submit vote
  router.post(
    '/api/v1/games/:gameId/vote',
    (req: Request, res: Response) => {
      try {
        const { voterId, targetId } = req.body;
        const result = gameEngine.submitVote(
          req.params.gameId,
          voterId,
          targetId,
        );

        if (!result.success) {
          return res
            .status(400)
            .json({ success: false, error: result.error });
        }

        res.json({
          success: true,
          data: { eventId: result.event?.id },
        });
      } catch (error) {
        res
          .status(500)
          .json({ success: false, error: 'Failed to submit vote' });
      }
    },
  );

  // Make accusation
  router.post(
    '/api/v1/games/:gameId/accusation',
    (req: Request, res: Response) => {
      try {
        const { accuserId, targetId, accusation, evidence } = req.body;
        const result = gameEngine.makeAccusation(
          req.params.gameId,
          accuserId,
          targetId,
          accusation,
          evidence,
        );

        if (!result.success) {
          return res
            .status(400)
            .json({ success: false, error: result.error });
        }

        res.json({
          success: true,
          data: { eventId: result.event?.id },
        });
      } catch (error) {
        res
          .status(500)
          .json({ success: false, error: 'Failed to make accusation' });
      }
    },
  );

  // Claim role
  router.post(
    '/api/v1/games/:gameId/claim-role',
    (req: Request, res: Response) => {
      try {
        const { playerId, role } = req.body;
        const result = gameEngine.claimRole(
          req.params.gameId,
          playerId,
          role,
        );

        if (!result.success) {
          return res
            .status(400)
            .json({ success: false, error: result.error });
        }

        res.json({
          success: true,
          data: { eventId: result.event?.id },
        });
      } catch (error) {
        res
          .status(500)
          .json({ success: false, error: 'Failed to claim role' });
      }
    },
  );

  // ==================== PLAYERS ====================

  // Get game players
  router.get(
    '/api/v1/games/:gameId/players',
    (req: Request, res: Response) => {
      try {
        const players = gameRepository.getPlayers(req.params.gameId);

        res.json({
          success: true,
          data: players,
        });
      } catch (error) {
        res
          .status(500)
          .json({ success: false, error: 'Failed to get players' });
      }
    },
  );

  return router;
}
