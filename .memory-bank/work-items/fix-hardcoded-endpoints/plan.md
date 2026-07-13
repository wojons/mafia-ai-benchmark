# WI: fix-hardcoded-endpoints

**Status:** in_progress
**Priority:** P0 — blocks all LLM-dependent ACs (Layer 2+)
**Created:** 2025-06-09

## Goal

Replace all hardcoded API endpoint URLs in `game-engine.js` with configurable values read from environment variables.

## Current State

`game-engine.js` has 4 hardcoded references to `https://openrouter.ai/api/v1/chat/completions`:

| Line | Context |
|------|---------|
| 129 | Persona generation API call |
| 4636 | Main LLM call function |
| 4683 | Endpoint config object |
| 4794 | Another LLM call path |

The `.env` file already exports `OPENAI_BASE_URL=https://api.neuralwatt.com/v1`. The engine reads `OPENAI_API_KEY` from env but ignores `OPENAI_BASE_URL`.

## Fix

1. Read `OPENAI_BASE_URL` from `process.env` near where `OPENAI_API_KEY` is read (line 623)
2. Replace all 4 hardcoded URL strings with the config variable
3. Build the full endpoint path as `${baseUrl}/chat/completions`

## Verification

```bash
cd ~/mafia-ai-benchmark
grep -c 'openrouter.ai' game-engine.js  # Should be 0 after fix
timeout 60 node game-engine.js 2>&1 | head -40  # Should boot without auth errors
```

## Related

- AC-006: NeuralWatt API reachable ✅
- AC-005: .env configured ✅
- Blocks: AC-020 through AC-027 (all real-LLM gates)
