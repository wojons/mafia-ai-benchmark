/**
 * Event-derived player extraction (shared seam, DF-MAFIA-AI-BENCHMARK-30).
 *
 * Lives in the db layer so GameRepository.getGame() can overlay event-derived
 * players onto empty/missing players-table rows WITHOUT importing the legacy
 * adapter (which imports GameRepository — a repository -> services import
 * would be a cycle). LegacyGameAdapter.extractPlayersFromEvents delegates to
 * extractPlayersFromEvents here, so the route fallback and the repository
 * overlay can never drift apart.
 *
 * Extraction rules (moved verbatim from the adapter, proven by the adapter's
 * own tests):
 *  - Every event actorId is a player.
 *  - ROLES_ASSIGNED carries the authoritative full assignment roster.
 *  - Death reveals (MORNING_REVEAL / PLAYER_LYNCHED / PLAYER_ELIMINATED /
 *    PLAYER_KILLED) carry full player objects in data.deaths; every death
 *    marks the actor dead.
 *  - Sheriff investigation / doctor protection / vigilante action and
 *    PRIVATE mafia-chat broadcasts reveal the actor's role.
 *  - Players whose role is never revealed keep 'UNASSIGNED' (and
 *    isMafia=false / isAlive=true as neutral defaults).
 */

import { GameEvent, Player } from '@mafia/shared/types';

export interface ExtractedPlayer {
  id: string;
  name: string;
  role: string;
  isMafia: boolean;
  isAlive: boolean;
  joinOrder: number;
}

export function extractPlayersFromEvents(events: GameEvent[]): ExtractedPlayer[] {
  const actorIds = new Set<string>();
  const nameByActor = new Map<string, string>();
  const roleByActor = new Map<string, string>();
  const mafiaByActor = new Map<string, boolean>();
  const deadActors = new Set<string>();

  const setRole = (id: string, role: string): void => {
    if (!roleByActor.has(id)) roleByActor.set(id, role);
  };
  const setMafia = (id: string, isMafia: boolean): void => {
    if (!mafiaByActor.has(id)) mafiaByActor.set(id, isMafia);
  };

  for (const event of events) {
    const data =
      event.data && typeof event.data === 'object'
        ? (event.data as Record<string, unknown>)
        : {};
    const actorId = event.actorId;

    // Track actor ids and names (existing behavior)
    if (actorId) {
      actorIds.add(actorId);
      if (!nameByActor.has(actorId) &&
          event.type === 'AGENT_SAYS_BROADCASTED' &&
          typeof data.playerName === 'string') {
        nameByActor.set(actorId, data.playerName);
      }
    }

    // 1. ROLES_ASSIGNED — authoritative full assignment
    if (event.type === 'ROLES_ASSIGNED') {
      if (Array.isArray(data.assignments)) {
        for (const assignment of data.assignments as Array<Record<string, unknown>>) {
          if (typeof assignment.playerId !== 'string' || typeof assignment.role !== 'string') continue;
          actorIds.add(assignment.playerId);
          setRole(assignment.playerId, assignment.role);
          setMafia(assignment.playerId, assignment.role === 'MAFIA');
        }
      }
      if (Array.isArray(data.mafiaTeam)) {
        for (const pid of data.mafiaTeam as unknown[]) {
          if (typeof pid !== 'string') continue;
          actorIds.add(pid);
          setMafia(pid, true);
        }
      }
    }

    // 2. Death reveals — night deaths (MORNING_REVEAL) plus per-death
    //    elimination events (PLAYER_LYNCHED / PLAYER_ELIMINATED /
    //    PLAYER_KILLED, MAF-GAP-044). All carry full player objects
    //    with role/isMafia/isAlive in data.deaths; every death marks
    //    the actor dead so detail isAlive becomes false.
    const isDeathEvent = event.type === 'MORNING_REVEAL'
      || event.type === 'PLAYER_LYNCHED'
      || event.type === 'PLAYER_ELIMINATED'
      || event.type === 'PLAYER_KILLED';
    if (isDeathEvent && Array.isArray(data.deaths)) {
      for (const death of data.deaths as Array<Record<string, unknown>>) {
        if (typeof death.id !== 'string') continue;
        actorIds.add(death.id);
        if (typeof death.role === 'string') setRole(death.id, death.role);
        if (typeof death.isMafia === 'boolean') setMafia(death.id, death.isMafia);
        deadActors.add(death.id);
        if (typeof death.name === 'string' && !nameByActor.has(death.id)) {
          nameByActor.set(death.id, death.name);
        }
      }
    }

    // 3. Sheriff investigation — target roles revealed; actor is the sheriff
    if (Array.isArray(data.targetRoles) && typeof data.targetId === 'string') {
      const roles = data.targetRoles as string[];
      const primaryRole = roles.length === 1 ? roles[0] : (roles.includes('MAFIA') ? 'MAFIA' : roles[0]);
      actorIds.add(data.targetId);
      setRole(data.targetId, primaryRole);
      setMafia(data.targetId, roles.includes('MAFIA'));
      if (actorId) {
        setRole(actorId, 'SHERIFF');
        setMafia(actorId, false);
      }
    }

    // 4. Doctor protection — actor is the doctor
    if (actorId &&
        typeof data.reason === 'string' &&
        typeof data.targetId === 'string' &&
        !Array.isArray(data.targetRoles)) {
      setRole(actorId, 'DOCTOR');
      setMafia(actorId, false);
    }

    // 5. Vigilante action — actor is the vigilante
    if (actorId && (data.action === 'SHOOT' || data.action === 'PASS')) {
      setRole(actorId, 'VIGILANTE');
      setMafia(actorId, false);
    }

    // 6. Mafia chat — PRIVATE legacy MESSAGE events only come from the
    //    MAFIA_CHAT phase, so the actor is mafia
    if (actorId &&
        event.type === 'AGENT_SAYS_BROADCASTED' &&
        event.visibility === 'PRIVATE' &&
        (data.legacyType === 'MESSAGE' || data.legacyType === 'MAFIA_CHAT')) {
      setRole(actorId, 'MAFIA');
      setMafia(actorId, true);
    }

    // 7. Generic role-carrying payloads (PLAYER_LYNCHED, MAFIA_KILL_SUCCEEDED, ...)
    if (typeof data.role === 'string') {
      if (typeof data.playerId === 'string') {
        actorIds.add(data.playerId);
        setRole(data.playerId, data.role);
      } else if (typeof data.targetId === 'string') {
        actorIds.add(data.targetId);
        setRole(data.targetId, data.role);
      } else if (actorId) {
        setRole(actorId, data.role);
      }
    }
    if (typeof data.targetRole === 'string' && typeof data.targetId === 'string') {
      actorIds.add(data.targetId);
      setRole(data.targetId, data.targetRole);
    }
  }

  return Array.from(actorIds).map((id, index) => ({
    id,
    name: nameByActor.get(id) || `Player ${id.substring(0, 8)}`,
    role: roleByActor.get(id) || 'UNASSIGNED',
    isMafia: mafiaByActor.get(id) ?? false,
    isAlive: !deadActors.has(id),
    joinOrder: index,
  }));
}

/**
 * Convert an extracted player into the shared Player shape the repository
 * and API layers use. Mirrors the route-level toApiPlayer mapping so
 * event-derived rows are indistinguishable from table rows.
 */
export function extractedPlayerToPlayer(p: ExtractedPlayer): Player {
  return {
    id: p.id,
    name: p.name,
    role: p.role as Player['role'],
    isAlive: p.isAlive,
    isMafia: p.isMafia,
    joinOrder: p.joinOrder,
  };
}