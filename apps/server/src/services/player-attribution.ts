/**
 * Per-player model attribution for the game detail route (MAF-GAP-029).
 *
 * The detail endpoint historically exposed only name/role/isAlive per
 * player, so a user could not tell which LLM played which role. This
 * module enriches each player with provider/model/tokensUsed/apiCalls
 * from real recorded rows:
 *
 *   provider/model  <- player_model_assignments, resolved in order:
 *                      1. player_id match   (native per-player assignment)
 *                      2. player_name match (native name-keyed assignment)
 *                      3. role match        (legacy role-level rows, which
 *                         use the player_id='ALL' sentinel; the benchmark
 *                         runner's 'TOWN' config key is normalised to
 *                         'VILLAGER' — the legacy engine runs town players
 *                         via VILLAGER_MODEL, see ROLE_ENV_MAP)
 *   tokensUsed/apiCalls (completed games only):
 *                      1. direct per-player aggregates (native games write
 *                         real player_id rows to token_usage/api_calls)
 *                      2. legacy per-model aggregates (player_id='ALL'
 *                         rows, one per (provider, model)) attributed ONLY
 *                         when the player is the sole player in the game
 *                         resolving to that model AND every player in the
 *                         game has a resolved model — a per-model total
 *                         sums the calls of every role assigned that
 *                         model, so it cannot be split honestly across
 *                         multiple players sharing the model, nor pinned
 *                         on one player while unresolved players might
 *                         have used it; those cases report 0
 *
 * Honesty contract (MAF-GAP-012/028 project standard): nothing is
 * fabricated. Players whose model cannot be determined keep
 * provider/model undefined; token numbers come only from recorded
 * token_usage/api_calls rows. apiCalls mirrors the getAgentStats
 * convention: COUNT of api_calls rows (legacy games record one aggregate
 * row per model, so the number reflects recorded rows, not wire calls).
 *
 * Attribution is best-effort: any failure returns the players unchanged
 * rather than breaking the detail route.
 */

import type { Player } from '@mafia/shared/types';
import type { GameRepository } from '../db/repository.js';

const LEGACY_PLAYER_SENTINEL = 'ALL';

const modelKey = (provider: string, model: string): string =>
  `${provider}\u0000${model}`;

/**
 * Normalise an assignment row's role for matching against player roles.
 * The benchmark runner assigns the town core under the 'TOWN' config key;
 * the legacy engine resolves those players via VILLAGER_MODEL, so a 'TOWN'
 * assignment describes VILLAGER players.
 */
function normalizeAssignmentRole(role: string | null): string | null {
  if (!role) return null;
  const upper = role.toUpperCase();
  return upper === 'TOWN' ? 'VILLAGER' : upper;
}

interface AssignmentLike {
  player_id: string | null;
  player_name: string | null;
  role: string | null;
  provider: string;
  model: string;
}

/** Resolve the (provider, model) a player was assigned, or undefined. */
function resolveAssignment(
  player: Player,
  assignments: AssignmentLike[],
): { provider: string; model: string } | undefined {
  // 1. Native per-player assignment (real player_id, never the sentinel).
  const byPlayerId = assignments.find(
    (a) => a.player_id !== null &&
      a.player_id !== LEGACY_PLAYER_SENTINEL &&
      a.player_id === player.id,
  );
  if (byPlayerId) return { provider: byPlayerId.provider, model: byPlayerId.model };

  // 2. Native name-keyed assignment.
  const byName = assignments.find(
    (a) => a.player_name !== null && a.player_name === player.name,
  );
  if (byName) return { provider: byName.provider, model: byName.model };

  // 3. Legacy role-level assignment. A player whose role was never
  //    revealed ('UNASSIGNED') has no honest chain to a model.
  if (player.role && player.role !== 'UNASSIGNED') {
    const byRole = assignments.find(
      (a) => normalizeAssignmentRole(a.role) === player.role,
    );
    if (byRole) return { provider: byRole.provider, model: byRole.model };
  }

  return undefined;
}

/**
 * Enrich game-detail players with per-player model attribution.
 *
 * @param isCompleted  true when the game has ended; token/apiCall numbers
 *                     are attached only for completed games (in-progress
 *                     games still get provider/model from assignments).
 */
export function enrichPlayersWithAttribution(
  gameRepository: GameRepository,
  gameId: string,
  players: Player[],
  isCompleted: boolean,
): Player[] {
  if (players.length === 0) return players;

  try {
    const db = typeof gameRepository.getDatabase === 'function'
      ? gameRepository.getDatabase()
      : null;
    if (!db) return players;

    const assignments: AssignmentLike[] =
      typeof gameRepository.getGameModelAssignments === 'function'
        ? gameRepository.getGameModelAssignments(gameId)
        : [];

    // Resolve provider/model for every player first — the ambiguity rule
    // needs the full per-model player count before attributing tokens.
    const resolved = players.map((p) => resolveAssignment(p, assignments));
    const modelPlayerCount = new Map<string, number>();
    for (const r of resolved) {
      if (!r) continue;
      const key = modelKey(r.provider, r.model);
      modelPlayerCount.set(key, (modelPlayerCount.get(key) ?? 0) + 1);
    }
    // A per-model aggregate sums every role assigned that model, so it is
    // only attributable when ALL players are resolved — an unresolved
    // player might have used the model too.
    const allResolved = resolved.every((r) => r !== undefined);

    // Aggregates, split by row provenance so the two branches can never
    // double-count: per-player rows (native) drive the direct branch;
    // legacy 'ALL' rows drive the per-model branch.
    const perPlayerTokens = new Map<string, number>();
    const perPlayerCalls = new Map<string, number>();
    const perModelTokens = new Map<string, number>();
    const perModelCalls = new Map<string, number>();

    if (isCompleted) {
      const tokenRows = db.prepare(`
        SELECT player_id, provider, model, SUM(total_tokens) AS tokens
        FROM token_usage WHERE game_id = ?
        GROUP BY player_id, provider, model
      `).all(gameId) as Array<{ player_id: string; provider: string; model: string; tokens: number | null }>;
      for (const row of tokenRows) {
        const tokens = row.tokens ?? 0;
        if (row.player_id === LEGACY_PLAYER_SENTINEL) {
          const key = modelKey(row.provider, row.model);
          perModelTokens.set(key, (perModelTokens.get(key) ?? 0) + tokens);
        } else {
          perPlayerTokens.set(
            row.player_id,
            (perPlayerTokens.get(row.player_id) ?? 0) + tokens,
          );
        }
      }

      const callRows = db.prepare(`
        SELECT player_id, provider, model, COUNT(*) AS calls
        FROM api_calls WHERE game_id = ?
        GROUP BY player_id, provider, model
      `).all(gameId) as Array<{ player_id: string; provider: string; model: string; calls: number }>;
      for (const row of callRows) {
        if (row.player_id === LEGACY_PLAYER_SENTINEL) {
          const key = modelKey(row.provider, row.model);
          perModelCalls.set(key, (perModelCalls.get(key) ?? 0) + row.calls);
        } else {
          perPlayerCalls.set(
            row.player_id,
            (perPlayerCalls.get(row.player_id) ?? 0) + row.calls,
          );
        }
      }
    }

    return players.map((player, i) => {
      const assignment = resolved[i];
      const enriched: Player = { ...player };
      if (assignment) {
        enriched.provider = assignment.provider;
        enriched.model = assignment.model;
      }
      if (!isCompleted) return enriched;

      // Branch 1: direct per-player usage rows (native engine path).
      const directTokens = perPlayerTokens.get(player.id);
      if (directTokens !== undefined) {
        enriched.tokensUsed = directTokens;
        enriched.apiCalls = perPlayerCalls.get(player.id) ?? 0;
        return enriched;
      }

      // Branch 2: legacy per-model aggregate — only when this player is
      // the SOLE player resolving to the model and no unresolved player
      // could also have used it. When several players share one model (or
      // some players' models are unknown) the aggregate cannot be split
      // honestly, so they get 0.
      if (assignment) {
        const key = modelKey(assignment.provider, assignment.model);
        if (allResolved && (modelPlayerCount.get(key) ?? 0) === 1) {
          enriched.tokensUsed = perModelTokens.get(key) ?? 0;
          enriched.apiCalls = perModelCalls.get(key) ?? 0;
          return enriched;
        }
      }

      // No attribution chain (or ambiguous shared model): zeros, never
      // fabricated numbers.
      enriched.tokensUsed = 0;
      enriched.apiCalls = 0;
      return enriched;
    });
  } catch (error) {
    console.error(
      `[player-attribution] Failed to enrich game ${gameId}:`,
      (error as Error)?.message || error,
    );
    return players;
  }
}
