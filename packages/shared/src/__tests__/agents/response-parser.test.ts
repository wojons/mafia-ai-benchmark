/**
 * Unit tests for the shared THINK/SAYS response parser + broadcast quality
 * gate (packages/shared/src/agents/response-parser.js).
 *
 * Fixtures mirror REAL model output shapes observed in production:
 *   - exact THINK:/SAYS: markers (the run-real-game.ts prompt format)
 *   - JSON objects (the legacy engine's "Return ONLY valid JSON" format)
 *   - markdown-fenced / prose-wrapped JSON
 *   - JSON with alternative keys (statement/message instead of says)
 *   - garbled output with no markers at all
 *   - empty output
 *   - repeated phrases (consecutive + 3x+ across a game)
 */

import { describe, it, expect } from 'vitest';
import { parseAgentResponse, createSayQualityGate } from '../../agents/response-parser.js';

describe('parseAgentResponse', () => {
  it('parses exact THINK:/SAYS: markers (run-real-game.ts format)', () => {
    const raw = [
      "THINK: I'm the doctor and I protected Alice last night.",
      "Alice claimed sheriff but voted against the confirmed town read.",
      'SAYS: I have no information yet. Everyone please share what they know.',
    ].join('\n');

    const parsed = parseAgentResponse(raw);
    expect(parsed.format).toBe('markers');
    expect(parsed.think).toContain("I'm the doctor");
    expect(parsed.says).toBe(
      'I have no information yet. Everyone please share what they know.',
    );
  });

  it('parses case-insensitive markers with missing SAYS', () => {
    const raw = 'think: I suspect Bob.\nsays: Bob is acting suspicious.';
    const parsed = parseAgentResponse(raw);
    expect(parsed.format).toBe('markers');
    expect(parsed.think).toBe('I suspect Bob.');
    expect(parsed.says).toBe('Bob is acting suspicious.');
  });

  it('parses line-based THINK:/SAYS: prefixes with continuation lines', () => {
    const raw = [
      'THINK: I suspect Alice.',
      'Bob is quiet too.',
      'SAYS: I think we should vote Alice.',
    ].join('\n');
    const parsed = parseAgentResponse(raw);
    expect(parsed.format).toBe('markers');
    expect(parsed.think).toBe('I suspect Alice.\nBob is quiet too.');
    expect(parsed.says).toBe('I think we should vote Alice.');
  });

  it('parses JSON objects (legacy engine prompt format)', () => {
    const raw = JSON.stringify({
      think: 'Alice is likely mafia given her voting pattern.',
      says: 'I vote to lynch Alice.',
      action: { target: 'Alice', reasoning: 'Voting pattern is suspicious' },
    });
    const parsed = parseAgentResponse(raw);
    expect(parsed.format).toBe('json');
    expect(parsed.think).toContain('Alice is likely mafia');
    expect(parsed.says).toBe('I vote to lynch Alice.');
    expect(parsed.action).toEqual({
      target: 'Alice',
      reasoning: 'Voting pattern is suspicious',
    });
  });

  it('parses markdown-fenced JSON (```json ... ```)', () => {
    const raw = [
      'Here is my response:',
      '```json',
      JSON.stringify({ think: 'keeping options open', says: 'No strong reads yet.' }),
      '```',
      'Hope that helps!',
    ].join('\n');
    const parsed = parseAgentResponse(raw);
    expect(parsed.format).toBe('json');
    expect(parsed.says).toBe('No strong reads yet.');
  });

  it('parses JSON with alternative statement keys (statement/message)', () => {
    const parsed = parseAgentResponse(
      JSON.stringify({ think: 'private', statement: 'public via statement', action: null }),
    );
    expect(parsed.format).toBe('json');
    expect(parsed.says).toBe('public via statement');

    const parsed2 = parseAgentResponse(
      JSON.stringify({ think: 'private', message: 'public via message' }),
    );
    expect(parsed2.says).toBe('public via message');
  });

  it('uses the whole output as SAYS when no markers or JSON are present (never empty)', () => {
    const raw =
      "I'm town and want to work together to find the mafia. Who are people's suspects?";
    const parsed = parseAgentResponse(raw);
    expect(parsed.format).toBe('plain');
    expect(parsed.says).toBe(raw);
    expect(parsed.think).toBe('');
  });

  it('never substitutes canned filler for missing SAYS', () => {
    const parsed = parseAgentResponse('THINK: only thinking here');
    expect(parsed.format).toBe('markers');
    expect(parsed.says).toBe('');
    expect(parsed.says).not.toBe("I don't have much to say yet.");
  });

  it('returns empty says only for truly empty model output', () => {
    expect(parseAgentResponse('').says).toBe('');
    expect(parseAgentResponse('   \n  ').says).toBe('');
    expect(parseAgentResponse(undefined as unknown as string).says).toBe('');
  });

  it('extracts a string action into an object', () => {
    const parsed = parseAgentResponse(
      JSON.stringify({ think: 'x', says: 'y', action: 'Alice' }),
    );
    expect(parsed.action).toEqual({ target: 'Alice' });
  });
});

describe('createSayQualityGate', () => {
  it('drops empty and whitespace-only statements', () => {
    const gate = createSayQualityGate();
    expect(gate.check('p1', '')).toBeNull();
    expect(gate.check('p1', '   \n  ')).toBeNull();
  });

  it('drops placeholder/filler statements', () => {
    const gate = createSayQualityGate();
    expect(gate.check('p1', '[Parse failed]')).toBeNull();
    expect(gate.check('p1', '[No public statement]')).toBeNull();
    expect(gate.check('p1', "[Budget exhausted - cannot continue discussion]")).toBeNull();
    expect(gate.check('p1', "I don't have much to say yet.")).toBeNull();
    expect(gate.check('p1', '...')).toBeNull();
  });

  it('dedupes consecutive exact repeats per player', () => {
    const gate = createSayQualityGate();
    expect(gate.check('p1', 'I think we should discuss who to vote for.')).toBe(
      'I think we should discuss who to vote for.',
    );
    // Same phrase again on the next turn: dropped.
    expect(gate.check('p1', 'I think we should discuss who to vote for.')).toBeNull();
    // A different phrase passes.
    expect(gate.check('p1', 'I now suspect Alice.')).toBe('I now suspect Alice.');
  });

  it('allows a phrase to repeat at most twice per game (no 3x+ exact repeat)', () => {
    const gate = createSayQualityGate();
    const phrase = 'I support targeting Bob.';

    expect(gate.check('p1', phrase)).toBe(phrase); // 1st occurrence
    expect(gate.check('p1', 'Something else entirely.')).toBe('Something else entirely.');
    expect(gate.check('p1', phrase)).toBe(phrase); // 2nd occurrence
    expect(gate.check('p1', 'Another distinct statement.')).toBe('Another distinct statement.');
    expect(gate.check('p1', phrase)).toBeNull(); // 3rd occurrence: dropped

    // The 2x cap is per player: another player can still use the phrase.
    expect(gate.check('p2', phrase)).toBe(phrase);
  });

  it('tracks state per player independently', () => {
    const gate = createSayQualityGate();
    const phrase = 'I am town.';
    expect(gate.check('p1', phrase)).toBe(phrase);
    expect(gate.check('p2', phrase)).toBe(phrase); // different player, allowed
    expect(gate.check('p1', phrase)).toBeNull(); // p1 consecutive repeat
  });

  it('reset() clears per-player state between games', () => {
    const gate = createSayQualityGate();
    const phrase = 'Vote Alice out.';
    gate.check('p1', phrase);
    gate.check('p1', 'other');
    expect(gate.check('p1', phrase)).toBe(phrase); // 2nd occurrence
    expect(gate.check('p1', phrase)).toBeNull(); // 3rd: dropped

    gate.reset();
    expect(gate.check('p1', phrase)).toBe(phrase); // fresh game: allowed again
  });

  it('reproduces the sampled-game scenario: 5x repeated mock phrase collapses to 2 broadcasts', () => {
    const gate = createSayQualityGate();
    const mockSay = 'I think we should discuss who to vote for.';
    const broadcasts: Array<string | null> = [];
    for (let i = 0; i < 5; i++) {
      // Simulate alternating phases so repeats are non-consecutive.
      broadcasts.push(gate.check('player-1', mockSay));
      gate.check('player-1', 'I have no new information.');
    }
    expect(broadcasts.filter(Boolean)).toHaveLength(2);
    expect(broadcasts[2]).toBeNull();
  });
});
