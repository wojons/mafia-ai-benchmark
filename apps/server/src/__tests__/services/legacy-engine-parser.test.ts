/**
 * Unit tests for the legacy engine's parser/quality-gate integration
 * (root game-engine.js, loaded directly — the same file the server spawns
 * via legacy-bridge.js).
 *
 * Covers the MAF-GAP-004 fix surface:
 *   - composeModelId: the double-prefix model-id bug that made EVERY
 *     game-play call fail (openai/openai/gpt-4o-mini -> HTTP 400) and
 *     forced all broadcasts to canned mock phrases.
 *   - parseJSONResponse: JSON + marker fallback, never "[No public statement]".
 *   - salvageUnparsed: whole-output-as-SAYS after retries are exhausted.
 *   - finalizeAgentResponse: the broadcast quality gate on engine responses.
 *   - getAIResponse (dry harness with stubbed fetch): the model id actually
 *     sent on the wire, and the response_format rejection fallback.
 *
 * NOTE: game-engine.js captures API_KEY at module load, so the module is
 * imported dynamically AFTER setting a dummy key (never a real one).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';

let gameEngine: any;

beforeAll(async () => {
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  // Pin the default model so the wire assertion is deterministic regardless
  // of what DEFAULT_MODEL the host shell exports.
  process.env.DEFAULT_MODEL = 'openai/gpt-4o-mini';
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - legacy CJS module without bundled types
  gameEngine = await import('../../../../../game-engine.js');
});

function makePlayer(id = 'p1', name = 'Alice', role = 'VILLAGER') {
  return {
    id,
    name,
    role,
    isAlive: true,
    isMafia: false,
    joinOrder: 1,
    persona: { name }, // createPrompt reads persona.name unguarded
  };
}

/** Instantiate the legacy engine (gameEngine is loaded in beforeAll). */
function newEngine(opts: Record<string, unknown> = {}) {
  return new gameEngine.MafiaGame(opts);
}

describe('composeModelId (root-cause fix: double-prefix model id)', () => {
  it('keeps a model id that already contains the provider prefix', () => {
    // The player-model-config default is "openai/gpt-4o-mini" WITH the
    // prefix; the old code composed "openai" + "/" + "openai/gpt-4o-mini"
    // -> "openai/openai/gpt-4o-mini" (HTTP 400 on OpenRouter).
    expect(gameEngine.composeModelId('openai', 'openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini');
  });

  it('prepends the provider for bare model names', () => {
    expect(gameEngine.composeModelId('openai', 'gpt-4o-mini')).toBe('openai/gpt-4o-mini');
    expect(gameEngine.composeModelId('qwen', 'qwen3.6-35b-fast')).toBe('qwen/qwen3.6-35b-fast');
  });

  it('handles empty model by returning the provider', () => {
    expect(gameEngine.composeModelId('openai', '')).toBe('openai');
    expect(gameEngine.composeModelId('openai', undefined)).toBe('openai');
  });
});

describe('MafiaGame.parseJSONResponse', () => {
  it('parses valid JSON with think/says/action', () => {
    const engine = newEngine({ maxRetries: 0 });
    const parsed = engine.parseJSONResponse(
      JSON.stringify({
        think: 'Alice voted against the confirmed town read.',
        says: 'I vote to lynch Alice.',
        action: { target: 'Alice', reasoning: 'suspicious voting' },
      }),
    );
    expect(parsed.valid).toBe(true);
    expect(parsed.think).toContain('Alice voted');
    expect(parsed.says).toBe('I vote to lynch Alice.');
    expect(parsed.action.target).toBe('Alice');
  });

  it('parses THINK:/SAYS: marker output (no JSON)', () => {
    const engine = newEngine({ maxRetries: 0 });
    const parsed = engine.parseJSONResponse(
      'THINK: I suspect Bob.\nSAYS: Bob is acting suspicious.',
    );
    expect(parsed.valid).toBe(true);
    expect(parsed.says).toBe('Bob is acting suspicious.');
  });

  it('never emits "[No public statement]" for JSON without a says field', () => {
    const engine = newEngine({ maxRetries: 0 });
    const parsed = engine.parseJSONResponse(JSON.stringify({ think: 'only thinking' }));
    expect(parsed.says).not.toBe('[No public statement]');
  });

  it('marks unparseable output invalid (retries/salvage handle it)', () => {
    const engine = newEngine({ maxRetries: 0 });
    const parsed = engine.parseJSONResponse('completely garbled output, no structure');
    expect(parsed.valid).toBe(false);
  });
});

describe('salvageUnparsed (never-empty SAYS after retries exhausted)', () => {
  it('turns garbled output into a usable statement', () => {
    const garbled =
      "I'm town and want to work together to find the mafia. Who are people's suspects?";
    const salvaged = gameEngine.salvageUnparsed(garbled);
    expect(salvaged).not.toBeNull();
    expect(salvaged.says).toBe(garbled);
    expect(salvaged.degraded).toBe(true);
    expect(salvaged.valid).toBe(false);
  });

  it('returns null for empty output (caller falls back to mock)', () => {
    expect(gameEngine.salvageUnparsed('')).toBeNull();
    expect(gameEngine.salvageUnparsed('   \n  ')).toBeNull();
  });

  it('recovers JSON embedded in prose', () => {
    const salvaged = gameEngine.salvageUnparsed(
      'Here you go: {"think":"t","says":"s","action":null} hope that helps',
    );
    expect(salvaged).not.toBeNull();
    expect(salvaged.says).toBe('s');
  });
});

describe('MafiaGame.finalizeAgentResponse (broadcast quality gate)', () => {
  it('passes through a fresh statement', () => {
    const engine = newEngine({ maxRetries: 0 });
    const out = engine.finalizeAgentResponse(makePlayer(), {
      valid: true,
      think: 't',
      says: 'I have real information to share.',
      action: null,
    });
    expect(out.says).toBe('I have real information to share.');
    expect(out.suppressed).toBe(false);
  });

  it('suppresses consecutive repeats (mock-fallback scenario)', () => {
    const engine = newEngine({ maxRetries: 0 });
    const player = makePlayer('p1', 'Alice');

    const first = engine.finalizeAgentResponse(player, {
      valid: false,
      think: '[Parse failed]',
      says: 'I think we should discuss who to vote for.',
      action: null,
    });
    expect(first.says).toBe('I think we should discuss who to vote for.');
    expect(first.suppressed).toBe(false);

    // Same player, same canned phrase on the next turn -> suppressed.
    const second = engine.finalizeAgentResponse(player, {
      valid: false,
      think: '[Parse failed]',
      says: 'I think we should discuss who to vote for.',
      action: null,
    });
    expect(second.says).toBe('');
    expect(second.suppressed).toBe(true);
  });

  it('suppresses placeholder statements', () => {
    const engine = newEngine({ maxRetries: 0 });
    const out = engine.finalizeAgentResponse(makePlayer(), {
      valid: true,
      think: '[No private thoughts]',
      says: '[No public statement]',
      action: null,
    });
    expect(out.says).toBe('');
    expect(out.suppressed).toBe(true);
  });

  it('tracks repeats per player (3rd occurrence dropped)', () => {
    const engine = newEngine({ maxRetries: 0 });
    const player = makePlayer('p1', 'Alice');
    const phrase = 'I support targeting Bob.';

    expect(engine.finalizeAgentResponse(player, { valid: true, think: 't', says: phrase, action: null }).suppressed).toBe(false);
    engine.finalizeAgentResponse(player, { valid: true, think: 't', says: 'Different statement.', action: null });
    expect(engine.finalizeAgentResponse(player, { valid: true, think: 't', says: phrase, action: null }).suppressed).toBe(false);
    engine.finalizeAgentResponse(player, { valid: true, think: 't', says: 'Another distinct one.', action: null });
    expect(engine.finalizeAgentResponse(player, { valid: true, think: 't', says: phrase, action: null }).suppressed).toBe(true);

    // A different player may still use the same phrase.
    const other = makePlayer('p2', 'Bob');
    expect(engine.finalizeAgentResponse(other, { valid: true, think: 't', says: phrase, action: null }).suppressed).toBe(false);
  });
});

describe('MafiaGame.getAIResponse (dry harness, stubbed fetch — no real API)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubFetch(handler: (body: any) => { ok: boolean; status: number; content: string }) {
    const bodies: any[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      const result = handler(body);
      return {
        ok: result.ok,
        status: result.status,
        json: async () => ({
          choices: [{ message: { content: result.content } }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
      };
    }) as any;
    return bodies;
  }

  function makeGameState() {
    // Must include every field createPrompt reads unguarded.
    return {
      phase: 'MAFIA_CHAT',
      dayNumber: 1,
      alivePlayers: [],
      deadPlayers: [],
      chatHistory: [],
    };
  }

  it('sends the composeModelId-correct model id (no double prefix) and parses JSON', async () => {
    const engine = newEngine({ maxRetries: 0, retryDelay: 0 });
    const bodies = stubFetch(() => ({
      ok: true,
      status: 200,
      content: JSON.stringify({ think: 'Alice is suspicious.', says: 'I vote to lynch Alice.', action: null }),
    }));

    const resp = await engine.getAIResponse(makePlayer(), makeGameState(), 0, false);

    // The wire model id must NOT be "openai/openai/gpt-4o-mini" (the 400 bug).
    expect(bodies[0].model).toBe('openai/gpt-4o-mini');
    expect(resp.says).toBe('I vote to lynch Alice.');
    expect(resp.suppressed).toBe(false);
    expect(resp.think).toContain('Alice is suspicious.');
  });

  it('retries WITHOUT response_format when the endpoint rejects it (400)', async () => {
    const engine = newEngine({ maxRetries: 1, retryDelay: 0 });
    let call = 0;
    const bodies = stubFetch((body) => {
      call += 1;
      if (call === 1) {
        // First attempt carries response_format -> endpoint rejects it.
        expect(body.response_format).toBeDefined();
        return { ok: false, status: 400, content: '{"error":{"message":"response_format not supported"}}' };
      }
      // Second attempt: response_format dropped.
      expect(body.response_format).toBeUndefined();
      return { ok: true, status: 200, content: JSON.stringify({ think: 't', says: 'recovered without format', action: null }) };
    });

    const resp = await engine.getAIResponse(makePlayer(), makeGameState(), 0, false);

    expect(bodies).toHaveLength(2);
    expect(resp.says).toBe('recovered without format');
  });

  it('salvages garbled output as SAYS after retries are exhausted (never mock filler)', async () => {
    const engine = newEngine({ maxRetries: 0, retryDelay: 0 });
    const garbled =
      "I'm town and want to work together to find the mafia. Who are people's suspects?";
    stubFetch(() => ({ ok: true, status: 200, content: garbled }));

    const resp = await engine.getAIResponse(makePlayer(), makeGameState(), 0, false);

    expect(resp.says).toBe(garbled);
    expect(resp.degraded).toBe(true);
  });

  it('suppresses repeated broadcasts through the gate (5x identical phrase -> 1 broadcast)', async () => {
    const engine = newEngine({ maxRetries: 0, retryDelay: 0 });
    const mockSay = 'I think we should discuss who to vote for.';
    stubFetch(() => ({ ok: true, status: 200, content: mockSay }));

    const player = makePlayer('p1', 'Alice');
    const saysSeen: string[] = [];
    for (let i = 0; i < 5; i++) {
      const resp = await engine.getAIResponse(player, makeGameState(), 0, false);
      saysSeen.push(resp.says);
    }

    // The 5 identical broadcasts collapse to a single real one (consecutive
    // dedupe is stricter than the 3x+ cap): the sampled-game degradation
    // ("1 player repeated the exact same phrase 5+ times") cannot recur.
    const broadcast = saysSeen.filter(s => s);
    expect(broadcast).toHaveLength(1);
    expect(broadcast[0]).toBe(mockSay);
  });

  it('caps parse-failure retries at ONE regardless of maxRetries (no retry storm)', async () => {
    const engine = newEngine({ maxRetries: 3, retryDelay: 1 });
    const garbled = 'completely garbled output, no structure';
    const bodies = stubFetch(() => ({ ok: true, status: 200, content: garbled }));

    const resp = await engine.getAIResponse(makePlayer(), makeGameState(), 0, false);

    // Exactly one retry — NOT maxRetries (3). The degenerate-output crawl
    // (3 retries x retryDelay x N players per turn, zero persisted events)
    // cannot happen.
    expect(bodies).toHaveLength(2);
    // After the single retry fails, the output is salvaged, not mock filler.
    expect(resp.says).toBe(garbled);
    expect(resp.degraded).toBe(true);
  });

  it('keeps network-error retries at maxRetries (only parse failures are capped)', async () => {
    const engine = newEngine({ maxRetries: 3, retryDelay: 1 });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error('ECONNRESET: network down');
    }) as any;

    const resp = await engine.getAIResponse(makePlayer(), makeGameState(), 0, false);

    // 1 initial attempt + 3 network retries = 4 calls, then mock fallback.
    expect(calls).toBe(4);
    expect(resp.says).toBe('I think we should target someone suspicious.');
    expect(resp.suppressed).toBe(false);
  });

  it('suppresses the same canned phrase across 4 different players (game-wide cap)', () => {
    const engine = newEngine({ maxRetries: 0 });
    const canned = 'I think we should target someone suspicious.';
    const players = [
      makePlayer('p1', 'Alice'),
      makePlayer('p2', 'Bob'),
      makePlayer('p3', 'Carol'),
      makePlayer('p4', 'Dan'),
    ];

    const out = players.map((p) =>
      engine.finalizeAgentResponse(p, {
        valid: false,
        think: '[Parse failed]',
        says: canned,
        action: null,
      }),
    );

    // Each player's per-player gate is fresh, so the per-player 2x cap does
    // NOT fire — the game-wide 3x cap is what drops the 4th broadcast
    // (the MAF-GAP-042 "4 canned duplicate SAYS across players" scenario).
    expect(out.map((o) => o.suppressed)).toEqual([false, false, false, true]);
    expect(out[3].says).toBe('');
  });
});
