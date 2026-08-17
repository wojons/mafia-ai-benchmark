/**
 * Agent Response Parser & Say Quality Gate
 *
 * Canonical THINK/SAYS extraction from raw LLM output, shared by:
 *   - the legacy game engine (game-engine.js, via require())
 *   - the standalone real-game runner (run-real-game.ts, via ESM import)
 *   - the vitest suite (packages/shared + apps/server tests)
 *
 * Fallback chain for parseAgentResponse (never substitutes canned filler):
 *   1. JSON object  -> { think, says, action } (handles {think,says},
 *      {thought,...}, {statement,...}, {message,...} key variants and
 *      markdown-fenced / prose-wrapped JSON)
 *   2. Exact THINK:/SAYS: markers (case-insensitive, multi-line)
 *   3. Line-based "THINK:" / "SAYS:" prefixed lines
 *   4. Whole raw output as SAYS (last resort -- never empty unless the
 *      model literally returned nothing)
 *
 * SayQualityGate (createSayQualityGate) enforces the minimum broadcast
 * quality bar:
 *   - drops empty / whitespace-only statements
 *   - drops known placeholder statements ("[Parse failed]", "[No public
 *     statement]", "I don't have much to say yet.", "...", budget-exceeded)
 *   - dedupes CONSECUTIVE exact repeats per player
 *   - drops the 3rd+ exact repeat of the same phrase per player per game
 *     (a phrase may be broadcast at most twice, never back-to-back)
 *   - drops the 4th+ exact repeat of the same phrase across the WHOLE game
 *     (any player) so a canned mock fallback cannot be broadcast by 4+
 *     different players (MAF-GAP-042 degenerate-output crawl: 4 canned
 *     duplicate SAYS across players in a 10p game)
 *
 * ESM (packages/shared is "type": "module"). game-engine.js loads it with
 * require() (Node >= 22.12 require(esm)); run-real-game.ts and tests import
 * it directly. Types live in response-parser.d.ts.
 */

// Statements that carry no information and must never be broadcast.
const PLACEHOLDER_SAYS = new Set([
  '[Parse failed]',
  '[No public statement]',
  '[No private thoughts]',
  '[Budget exhausted - cannot continue discussion]',
  "I don't have much to say yet.",
  '...',
]);

export function clean(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/^\s+/, '').replace(/\s+$/, '').replace(/\r\n/g, '\n').trim();
}

/**
 * Extract a JSON object from model output. Tries a full parse first, then a
 * brace-scan (handles markdown fences and prose surrounding the JSON).
 */
function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;

  const full = clean(text);
  if (full.startsWith('{') || full.startsWith('[')) {
    try {
      const parsed = JSON.parse(full);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (e) {
      // fall through to brace-scan
    }
  }

  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (!braceMatch) return null;
  try {
    const parsed = JSON.parse(braceMatch[0]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (e) {
    return null;
  }
  return null;
}

/**
 * Extract THINK:/SAYS: fields. First the exact-marker regex (the original
 * run-real-game.ts approach, kept for compatibility), then a line-based scan
 * that tolerates missing markers and collects continuation lines.
 */
function extractMarkerFields(text) {
  const thinkMatch = text.match(/THINK:\s*([\s\S]*?)(?=SAYS:|$)/i);
  const saysMatch = text.match(/SAYS:\s*([\s\S]*?)$/i);

  if (thinkMatch || saysMatch) {
    return {
      think: thinkMatch ? clean(thinkMatch[1]) : '',
      says: saysMatch ? clean(saysMatch[1]) : '',
    };
  }

  // Line-based fallback: lines starting with THINK:/SAYS: plus their
  // continuation lines, so output like:
  //   THINK: I suspect Alice.
  //   Bob is quiet.
  //   SAYS: I think we should vote Alice.
  // is parsed correctly even without exact marker alignment.
  const lines = text.split('\n');
  let section = null;
  const thinkLines = [];
  const saysLines = [];

  for (const line of lines) {
    const thinkPrefix = line.match(/^\s*THINK:\s*(.*)$/i);
    const saysPrefix = line.match(/^\s*SAYS:\s*(.*)$/i);

    if (thinkPrefix) {
      section = 'think';
      if (thinkPrefix[1].trim()) thinkLines.push(thinkPrefix[1].trim());
      continue;
    }
    if (saysPrefix) {
      section = 'says';
      if (saysPrefix[1].trim()) saysLines.push(saysPrefix[1].trim());
      continue;
    }
    if (section === 'think' && line.trim()) thinkLines.push(line.trim());
    else if (section === 'says' && line.trim()) saysLines.push(line.trim());
  }

  if (thinkLines.length || saysLines.length) {
    return { think: thinkLines.join('\n'), says: saysLines.join('\n') };
  }
  return null;
}

/**
 * Parse raw model output into { think, says, action, format }.
 * Guarantees: says is never a canned placeholder; it is either a real
 * extracted field or the whole raw output (empty only if the model produced
 * nothing at all).
 */
export function parseAgentResponse(text) {
  const raw = typeof text === 'string' ? text : '';
  const result = { think: '', says: '', action: null, format: 'fallback' };

  // 1. JSON object (strict prompt format: {"think","says","action"})
  const json = extractJson(raw);
  if (json) {
    const think = clean(json.think ?? json.thought ?? json.reasoning ?? '');
    const says = clean(json.says ?? json.statement ?? json.message ?? json.say ?? '');
    const action = json.action ?? null;
    if (think || says || action) {
      result.think = think;
      result.says = says;
      result.action =
        action && typeof action === 'object' ? action : typeof action === 'string' ? { target: action } : null;
      result.format = 'json';
      return result;
    }
  }

  // 2/3. THINK:/SAYS: markers (exact regex, then line-based)
  const markers = extractMarkerFields(raw);
  if (markers) {
    result.think = markers.think;
    result.says = markers.says;
    result.format = 'markers';
    return result;
  }

  // 4. Last resort: whole output as SAYS (never empty, never filler)
  result.says = clean(raw);
  result.format = 'plain';
  return result;
}

/**
 * Create a per-game quality gate enforcing the broadcast minimum bar.
 * Returns a new gate with an isolated per-player state.
 */
export function createSayQualityGate() {
  const lastSays = new Map(); // playerId -> last broadcast phrase
  const phraseCounts = new Map(); // playerId -> Map<phrase, count>
  const gamePhraseCounts = new Map(); // phrase -> count across ALL players
  const MAX_REPEAT = 2; // a phrase may be broadcast at most twice per player per game
  const MAX_GAME_REPEAT = 3; // ...and at most 3 times across the whole game

  /**
   * Validate and record a player's statement.
   * @returns {string|null} the statement to broadcast, or null when it must
   *   be dropped (empty, placeholder, consecutive duplicate, per-player
   *   3rd+ repeat, or game-wide 4th+ repeat).
   */
  function check(playerId, says) {
    const text = clean(says);
    if (!text) return null;
    if (text.length < 2) return null;
    if (PLACEHOLDER_SAYS.has(text)) return null;

    const prev = lastSays.get(playerId);
    if (prev === text) return null; // consecutive exact duplicate

    let counts = phraseCounts.get(playerId);
    if (!counts) {
      counts = new Map();
      phraseCounts.set(playerId, counts);
    }
    const count = counts.get(text) || 0;
    if (count >= MAX_REPEAT) return null; // 3rd+ exact repeat for this player

    // Game-wide cap: a canned/mock fallback phrase may be broadcast at most
    // 3 times across the WHOLE game regardless of player, so a degenerate
    // episode cannot surface 4+ identical canned SAYS from different players.
    const gameCount = gamePhraseCounts.get(text) || 0;
    if (gameCount >= MAX_GAME_REPEAT) return null;

    counts.set(text, count + 1);
    gamePhraseCounts.set(text, gameCount + 1);
    lastSays.set(playerId, text);
    return text;
  }

  function reset() {
    lastSays.clear();
    phraseCounts.clear();
    gamePhraseCounts.clear();
  }

  return { check, reset };
}
