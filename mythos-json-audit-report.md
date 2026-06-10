# Mythos Codebase — JSON Schema Output Audit

**Date:** 2026-06-09
**Project:** `/home/kara/helios-work/mythos`
**Focus:** All AI model calls (LLM + vision) that produce unstructured/free-text output instead of structured JSON schema output

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 HIGH  | 1     |
| 🟡 MEDIUM | 1     |
| 🟢 LOW    | 3     |
| ✅ N/A (image gen, correct) | 5 |

---

## 🔴 HIGH — World Assistant Service

### File: `packages/backend/src/services/world-assistant.service.ts`

**What it does:**
- **Lines 47-62**: Calls `llmProvider.chat()` with `temperature: 0.7` to generate world-building suggestions.
- **Lines 93-131** (`buildSuggestionPrompt`): Builds a prompt that asks for JSON *in natural language text* (includes a sample JSON schema in the prompt). **Does NOT set `response_format: "json"` on the LLM request.**
- **Lines 134-152** (`parseLLMResponse`): Parses response using **regex extraction**: `response.match(/\{[\s\S]*\}/)` to find JSON in free-text output. Falls back to hardcoded defaults on parse failure.
- **Line 57-58**: `model: "gpt-4o-mini"` hardcoded, `temperature: 0.7` (too high for structured output).

**Why HIGH:** The LLM is asked for JSON via text prompt only, the API's native `response_format: "json_object"` is never set, and parsing relies on regex to extract JSON from potentially wrapped free-text responses. High temperature (0.7) further encourages unstructured output.

---

## 🟡 MEDIUM — Verification Service

### File: `packages/backend/src/services/verification.service.ts`

**What it does:**
- **Lines 99-262** (8 prompt builders): `buildColorsPrompt`, `buildPanelsPrompt`, `buildTextImageAlignmentPrompt`, `buildContinuityPrompt`, `buildContinuityWithPreviousPrompt`, `buildArtifactsPrompt`, `buildCharacterConsistencyPrompt`, `buildContextInjectionPrompt` — all ask the model to "Respond with a JSON object" and "Only return valid JSON, no other text" **in natural language only**.
- **Lines 450-528** (`callVisionModel`): Makes the actual `fetch()` call to OpenRouter. Sets `temperature: 0.1` (good) but **does NOT set `response_format: { type: "json_object" }`** — this parameter is missing from the request body.
- **Lines 531-566** (`parseVisionResponse`): Parses response with three-tier fallback:
  1. `JSON.parse(response)` (direct)
  2. Regex extraction from markdown code blocks: `response.match(/```(?:json)?\s*([\s\S]*?)```/)`
  3. Regex score extraction: `response.match(/"score"\s*:\s*([\d.]+)/)` — last resort

**Why MEDIUM:** The prompts correctly request JSON and temperature is low (0.1), but without `response_format: "json_object"` at the API level, the model can still return free-text with markdown wrapping. The multi-tier regex fallback parsing confirms this is a known problem. For the Anthropic/openrouter models being used, `response_format` support may vary, but where supported it should be used.

---

## 🟢 LOW — OpenAI LLM Provider (has the right mechanism, not always used)

### File: `packages/backend/src/providers/llm/openai.ts`

**What it does:**
- **Lines 182-184**: Correctly maps `request.responseFormat === "json"` → `response_format: { type: "json_object" }` in the API body. This is the **reference implementation** that should be used everywhere.
- **Lines 153-154**: Sets `temperature: 0.7` and `max_tokens: request.maxTokens` as defaults.

**Why LOW:** The JSON mode hook exists but is only used when consumers pass `responseFormat: "json"`. Currently, only the World Assistant service calls `chat()` — and it does NOT pass `responseFormat: "json"`.

---

## 🟢 LOW — LLM Base Types (defines `responseFormat`)

### File: `packages/backend/src/providers/llm/base.ts`

**Lines 176, 204**: Both `LLMTextRequest` and `LLMChatRequest` define:
```typescript
responseFormat?: "text" | "json";
```

**Why LOW:** The type system supports it, but the callers don't use it.

---

## 🟢 LOW — Generation Service (dialogue is placeholder)

### File: `packages/backend/src/services/generation.service.ts`

**Lines 1045-1083** (`executeDialogueGeneration`): Currently returns **hardcoded placeholder dialogue** with a comment: `"For dialogue, we would typically use an LLM provider. For now, return a placeholder result"`. When this is finally implemented, it will need JSON schema output.

**Lines 626-650** (`executeGeneration`): Routes to page/portrait/world_art/dialogue/frame handlers. The image generation calls (page, portrait, world_art, frame) correctly send free-text prompts to image generation APIs — this is expected.

---

## ✅ N/A (Correct — Image Generation Prompts)

These files send free-text prompts to image generation APIs, which is correct behavior:

### File: `packages/backend/src/generation/prompt-builder.ts`
- **Lines 100-271**: Templates (`manga_page`, `portrait`, `scene`, `dialogue`) produce free-text image generation prompts. These are image prompts, not text-model output. **Correct.**

### File: `packages/backend/src/providers/image/openrouter.ts`
- **Lines 63-104**: Sends free-text prompt to OpenRouter image generation API with `modalities: ["image"]` or `["image", "text"]`. **Correct.**

### File: `packages/backend/src/providers/image/dalle.ts`
- **Lines 78-126**: Sends free-text prompt to DALL-E API. **Correct.**

### File: `packages/backend/src/providers/image/stable-diffusion.ts`
- **Lines 69-131**: Sends free-text prompt to Stability AI API. **Correct.**

### File: `packages/backend/src/providers/image/nano-banana.ts`
- **Lines 79-140**: Sends free-text prompt to Nano Banana API. **Correct.**

---

## Files NOT Making AI Calls (Searched, No Findings)

- `packages/backend/src/services/conversation.service.ts` — no LLM/API calls
- `packages/backend/src/generation/timeline-generator.ts` — no LLM/API calls
- `packages/backend/src/generation/oop-pipeline.ts` — orchestration only, delegates to PromptBuilder
- `packages/backend/src/generation/state-machine.ts` — state machine, no AI calls
- `packages/backend/src/generation/autonomy-integration.ts` — logic, no AI calls
- `packages/backend/src/generation/context-assembler.ts` — data assembly, no AI calls
- `packages/backend/src/generation/dedup-manager.ts` — dedup logic, no AI calls
- `packages/backend/src/services/audit.service.ts` — audit logging, no AI calls
- `packages/backend/src/services/backup.service.ts` — file ops, no AI calls
- All other service files — no AI calls found
- `scripts/` directory — does not exist at this path
- Test files — no AI output parsing found (tests test prompt building, not response parsing)

---

## Action Items (Priority Order)

### P1 — Fix World Assistant Service (`world-assistant.service.ts`)
1. Add `responseFormat: "json"` to the `llmProvider.chat()` call (line 50)
2. Lower `temperature` from 0.7 to 0.1-0.2 for consistent structured output
3. The regex parsing fallback can remain as safety net

### P2 — Fix Verification Service (`verification.service.ts`)
1. Add `response_format: { type: "json_object" }` to the `callVisionModel()` request body (around line 483-493) **if the OpenRouter model supports it** (models like GPT-4o, Claude 3.5+ do)
2. The prompt text can remain as-is; the `response_format` param is the enforcement

### P3 — Future-proof Dialogue Generation (`generation.service.ts`)
1. When `executeDialogueGeneration()` (line 1045) is implemented with a real LLM call, ensure it uses `responseFormat: "json"` with a JSON schema in the system prompt
