/**
 * Player stats methods for StatsCollector.
 *
 * Extracted from the monolithic stats-collector.ts to reduce file size.
 */

import type { GameRepository } from '../../db/repository.js';

/**
 * Derive player info from game events when the players table is empty.
 * Extracts player IDs, names, roles, and alive/mafia status from event data.
 */
export function getPlayersFromEvents(
  gameRepository: GameRepository,
  gameId: string,
): Array<{
  id: string;
  name: string;
  role: string;
  isAlive: boolean;
  isMafia: boolean;
}> {
  try {
    const events = gameRepository.getEvents(gameId);

    const playerIds = new Set<string>();
    const playerNames = new Map<string, string>();
    const playerRoles = new Map<string, string>();
    const eliminatedPlayers = new Set<string>();
    const mafiaPlayers = new Set<string>();

    for (const e of events) {
      if (e.actorId) playerIds.add(e.actorId);
      if (e.targetId) playerIds.add(e.targetId);

      const data = e.data as Record<string, unknown> | undefined;

      if (e.actorId && data?.playerName) {
        playerNames.set(e.actorId, data.playerName as string);
      }

      if (e.targetId && data?.targetName) {
        playerNames.set(e.targetId, data.targetName as string);
      }

      if (e.type === 'MORNING_REVEAL' && data?.deaths) {
        for (const death of data.deaths as Array<Record<string, unknown>>) {
          if (death.id) {
            eliminatedPlayers.add(death.id as string);
            if (death.name) playerNames.set(death.id as string, death.name as string);
            if (death.role) playerRoles.set(death.id as string, death.role as string);
            if (death.isMafia) mafiaPlayers.add(death.id as string);
          }
        }
      }
    }

    const dbPlayers = gameRepository.getPlayers(gameId);
    const dbPlayerMap = new Map(dbPlayers.map((p) => [p.id, p]));

    return Array.from(playerIds).map((pid) => {
      const dbPlayer = dbPlayerMap.get(pid);
      const isEliminated = eliminatedPlayers.has(pid);

      let role = 'VILLAGER';
      if (dbPlayer?.role && dbPlayer.role !== 'UNASSIGNED') {
        role = dbPlayer.role;
      } else if (playerRoles.has(pid)) {
        role = playerRoles.get(pid)!;
      }

      return {
        id: pid,
        name: playerNames.get(pid) || dbPlayer?.name || 'Unknown',
        role,
        isAlive: dbPlayer ? dbPlayer.isAlive : !isEliminated,
        isMafia: dbPlayer ? dbPlayer.isMafia : mafiaPlayers.has(pid),
      };
    });
  } catch (e) {
    console.error(
      'StatsCollector.getPlayersFromEvents: failed to derive players from game events for game',
      gameId,
      e,
    );
    return [];
  }
}

/**
 * Calculate role-specific performance score (0-100)
 */
export function calculateRolePerformance(role: string, survived: boolean): number {
  let score = 50;

  if (survived) {
    score += 20;
  }

  switch (role) {
    case 'MAFIA':
      score += survived ? 30 : 0;
      break;
    case 'DOCTOR':
      score += survived ? 25 : 0;
      break;
    case 'SHERIFF':
      score += survived ? 25 : 0;
      break;
    case 'VIGILANTE':
      score += survived ? 20 : 0;
      break;
    case 'VILLAGER':
      score += survived ? 25 : 0;
      break;
  }

  return Math.min(100, Math.max(0, score));
}
