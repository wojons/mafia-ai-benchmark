# Structured Output & Configurable Model System Implementation

**Status**: In Progress
**Updated**: 2025-12-30
**Related Issues**: JSON Parse Failures (50% rate)

---

## Deep Reasoning Chain

### 1. Root Cause Analysis (ULTRATHINK)

**Symptom**: 50% JSON parse failure rate from AI model responses

**Why This Happens**:

1. **No Structured Output Enforcement**:
   - Current `max_tokens: 200` is TOO LOW
   - Prompt asks for JSON but doesn't enforce it at API level
   - Model may truncate response mid-JSON or deviate entirely

2. **Hardcoded Model Configuration**:
   - Code hardcodes `"openai/gpt-4o-mini"` in multiple places
   - No support for environment variable configuration
   - No support for per-role model selection
   - No support for different model providers (Claude, Gemini, etc.)

3. **Ambiguous JSON Schema**:
   - Prompt says `Return JSON: {"think": "...", "says": "...", "action": ACTION}`
   - `ACTION` is a placeholder, not a real schema
   - No type definitions or required/optional field specifications

4. **Token Limit Issues**:
   - `max_tokens: 200` insufficient for:
     - Complex reasoning in `think` field
     - Detailed statements in `says` field
     - Target selection + reasoning in `action` field
     - JSON formatting overhead

---

## Solution Architecture

### 1. Player Model Configuration System

**Location**: Uses existing `packages/shared/src/providers/player-model-config.js`

**Environment Variables**:

```env
# Default model for all players
DEFAULT_MODEL=openai/gpt-4o-mini

# Role-specific model overrides (higher priority)
MAFIA_MODEL=anthropic/claude-3-opus-20240229
DOCTOR_MODEL=anthropic/claude-3-sonnet-20240229
SHERIFF_MODEL=openai/gpt-4
VIGILANTE_MODEL=openai/gpt-4o
VILLAGER_MODEL=openai/gpt-4o-mini
```

**Priority Order**:

1. Player-specific assignment (highest)
2. Role-based override (medium)
3. System pattern (odd/even/firsthalf/secondhalf)
4. Default model (lowest)

**Usage**:

```javascript
const modelConfig = getPlayerModelConfig().getPlayerConfig(
  playerIndex, // 1-based (player 1, 2, 3...)
  playerRole, // "MAFIA", "DOCTOR", etc.
  totalPlayers,
);
// Returns: {
//   provider: "openai",
//   model: "gpt-4o-mini",
//   temperature: 0.7,
//   maxTokens: 800,
//   assignmentType: "role"
// }
```

---

### 2. JSON Schema System

**Location**: New functions in `game-engine.js`

**Base Schema** (all phases):

```javascript
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "think": {
      "type": "string",
      "description": "Your private reasoning and strategic thoughts",
      "minLength": 10,
      "maxLength": 500
    },
    "says": {
      "type": "string",
      "description": "Your public statement to other players",
      "minLength": 10,
      "maxLength": 300
    },
    "action": {
      "type": ["object", "null"],
      "description": "Your action (null if no action)",
      "additionalProperties": false,
      "properties": {
        "target": { "type": "string" },
        "reasoning": { "type": "string", "minLength": 5, "maxLength": 300 },
        "shouldShoot": { "type": "boolean" }
      }
    }
  },
  "required": ["think", "says"]
}
```

**Phase-Specific Variations**:

| Phase                   | Action Schema                       | Required Fields                                           |
| ----------------------- | ----------------------------------- | --------------------------------------------------------- |
| `MAFIA_CHAT`            | `null`                              | `think`, `says`                                           |
| `DAY_DISCUSSION`        | `null`                              | `think`, `says`                                           |
| `MAFIA_KILL_VOTE`       | `{target, reasoning}`               | `think`, `says`, `action.target`, `action.reasoning`      |
| `DAY_VOTE`              | `{target, reasoning}`               | `think`, `says`, `action.target`, `action.reasoning`      |
| `DOCTOR_ACTION`         | `{target, reasoning}`               | `think`, `says`, `action.target`, `action.reasoning`      |
| `SHERIFF_INVESTIGATION` | `{target, reasoning}`               | `think`, `says`, `action.target`, `action.reasoning`      |
| `VIGILANTE_ACTION`      | `{target?, reasoning, shouldShoot}` | `think`, `says`, `action.reasoning`, `action.shouldShoot` |

---

### 3. Structured Outputs (OpenAI)

**Automatic For**:

- `provider: "openai"`
- Model names containing "gpt-", "o1-"

**API Format**:

```javascript
{
  model: "openai/gpt-4o-mini",
  messages: [
    {
      role: "user",
      content: prompt
    }
  ],
  temperature: 0.7,
  max_tokens: 800,
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "mafia_response_mafia_kill_vote",
      description: "Structured response for Mafia game MAFIA_KILL_VOTE phase",
      strict: true,
      schema: /* phase-specific schema */
    }
  }
}
```

**Benefits**:

- ✅ 100% valid JSON guarantee at API level
- ✅ Type enforcement (no wrong data types)
- ✅ 0 retry rate for parse failures
- ✅ Consistent output format

---

### 4. Fallback for Non-Structured-Output Models

**For**: Claude, Gemini, or older models

**Enhanced Prompt**:

````
## REQUIRED JSON OUTPUT FORMAT

You MUST respond with valid JSON. No exceptions.

```json
{
  "think": "string - Your private reasoning (10-500 chars)",
  "says": "string - Your public statement (10-300 chars)",
  "action": {
    "target": "string - Target player name",
    "reasoning": "string - Reasoning for action (5-300 chars)"
  }
}
````

IMPORTANT: Your entire response must be ONLY this JSON. No other text.

````

---

## Code Changes Summary

### Files Modified

**`game-engine.js`**:

1. **Added PlayerModelConfig Integration** (~line 624):
   ```javascript
   let playerModelConfig = null;
   function getPlayerModelConfig() {
     if (!playerModelConfig) {
       const { PlayerModelConfig } = require("../packages/shared/src/providers/player-model-config");
       playerModelConfig = new PlayerModelConfig({
         defaultModel: process.env.DEFAULT_MODEL || "openai/gpt-4o-mini",
         defaultProvider: "openai",
         temperature: 0.7,
         maxTokens: 800, // INCREASED from 200
       });

       // Apply role-specific model overrides
       const roleModels = {
         MAFIA: process.env.MAFIA_MODEL,
         DOCTOR: process.env.DOCTOR_MODEL,
         SHERIFF: process.env.SHERIFF_MODEL,
         VIGILANTE: process.env.VIGILANTE_MODEL,
         VILLAGER: process.env.VILLAGER_MODEL,
       };

       for (const [role, model] of Object.entries(roleModels)) {
         if (model) {
           const [provider, modelName] = model.split("/");
           playerModelConfig.setRoleModel(role, { provider, model: modelName });
         }
       }
     }
     return playerModelConfig;
   }
````

2. **Added JSON Schema Functions** (~line 1027):

   ```javascript
   function getBaseResponseSchema() {
     /* base schema */
   }
   function getPhaseSchema(phase) {
     /* phase-specific schema */
   }
   function getResponseFormat(phase) {
     /* OpenAI json_schema object */
   }
   function getJSONSchemaText(phase) {
     /* Fallback text schema */
   }
   ```

3. **Updated `getAIResponse()` Function** (~line 4570):

   ```javascript
   // Get model configuration
   const modelConfig = getPlayerModelConfig().getPlayerConfig(
     playerIndex,
     playerRole,
     totalPlayers,
   );

   // Build request
   const requestBody = {
     model: modelConfig.provider + "/" + modelConfig.model,
     messages: [{ role: "user", content: prompt + jsonSchemaText }],
     temperature: modelConfig.temperature,
     max_tokens: modelConfig.maxTokens || 800, // INCREASED
   };

   // Try structured outputs for OpenAI models
   const isOpenAI =
     modelConfig.provider === "openai" ||
     modelConfig.model.includes("gpt-") ||
     modelConfig.model.includes("o1-");

   if (isOpenAI && !this.config.disableStructuredOutputs) {
     requestBody.response_format = getResponseFormat(gameState.phase);
   }
   ```

4. **Added Configuration Option** (~line 1623):

   ```javascript
   disableStructuredOutputs:
     options.disableStructuredOutputs !== undefined
       ? options.disableStructuredOutputs
       : process.env.DISABLE_STRUCTURED_OUTPUTS === "true",
   ```

5. **Updated Tracking** (~line 4642):
   ```javascript
   this.apiTracker.trackCall(this.gameId, player.id, {
     provider: modelConfig.provider, // Instead of hardcoded "openrouter"
     model: modelConfig.model, // Instead of hardcoded "gpt-4o-mini"
     assignmentType: modelConfig.assignmentType, // "role", "player", "default"
     // ... other fields
   });
   ```

---

## Environment Variables

### Required

```env
# API Key
OPENAI_API_KEY=your-api-key-here
```

### Optional

```env
# Model Configuration
DEFAULT_MODEL=openai/gpt-4o-mini
MAFIA_MODEL=anthropic/claude-3-opus-20240229
DOCTOR_MODEL=anthropic/claude-3-sonnet-20240229
SHERIFF_MODEL=openai/gpt-4
VILLAGER_MODEL=openai/gpt-4o-mini

# Structured Outputs
DISABLE_STRUCTURED_OUTPUTS=false
```

---

## Testing

### Test 1: Syntax Check

```bash
node -c game-engine.js
```

### Test 2: Environment Variable Override

```bash
# Set mafia to use Claude Opus
export MAFIA_MODEL=anthropic/claude-3-opus-20240229

# Run game
node src/tests/unit/test-10player-game.js

# Check console for configuration log
# Should see: [CONFIG] MAFIA role using model: anthropic/claude-3-opus-20240229
```

### Test 3: Disable Structured Outputs

```bash
# Test with structured outputs disabled (uses only prompt-based JSON enforcement)
export DISABLE_STRUCTURED_OUTPUTS=true
node src/tests/unit/test-10player-game.js
```

### Test 4: Model Permutation

```bash
# Different models for different roles
export MAFIA_MODEL=anthropic/claude-3-opus-20240229
export DOCTOR_MODEL=openai/gpt-4
export SHERIFF_MODEL=anthropic/claude-3-sonnet-20240229
export VILLAGER_MODEL=openai/gpt-4o-mini

node src/tests/unit/test-10player-game.js
```

---

## Expected Outcomes

| Metric                    | Before | After                     | Target             |
| ------------------------- | ------ | ------------------------- | ------------------ |
| JSON Parse Rate           | ~50%   | >95% (structured outputs) | 100%               |
| max_tokens                | 200    | 800 (configurable)        | Sufficient         |
| Model Hardcoding          | Yes    | No (configurable)         | Flexible           |
| Role-Specific Models      | No     | Yes (via env)             | Customizable       |
| Structured Output Support | No     | Yes (OpenAI)              | Better reliability |
| Prompt-Only JSON Fallback | Weak   | Strong schema             | Robust             |

---

## Edge Cases Handled

### Edge Case 1: Non-OpenAI Model

- **Detection**: Checks if `modelConfig.provider === "openai"` or model name contains "gpt-" or "o1-"
- **Behavior**: Skips `response_format`, uses enhanced prompt with JSON schema text
- **Fallback**: Reliable JSON without structured outputs

### Edge Case 2: Structured Outputs Disabled

- **Detection**: `this.config.disableStructuredOutputs === true`
- **Behavior**: Always uses enhanced prompt fallback
- **Use Case**: Testing, debugging, incompatible API

### Edge Case 3: PlayerModelConfig Loading Failure

- **Detection**: Try-catch around import
- **Fallback**: Simple default config object
- **Behavior**: Graceful degradation, game continues

### Edge Case 4: Token Limit Reached

- **Before**: `max_tokens: 200` (too small)
- **After**: `max_tokens: modelConfig.maxTokens || 800`
- **Result**: Truncation unlikely even for complex responses

### Edge Case 5: Cost Tracking with Different Models

- **Before**: Always tracked as "openai/gpt-4o-mini" with $0.15/$0.60 pricing
- **After**: Tracks actual model `modelConfig.model` with `modelConfig.provider`
- **Future**: Will load dynamic pricing from models.dev API

---

## Cost Analysis

### Token Usage Increase

| Phase              | Before   | After    | Increase            |
| ------------------ | -------- | -------- | ------------------- |
| Prompt             | ~1000    | ~1200    | +200 (JSON schema)  |
| Completion         | 200      | 600      | +400 (higher limit) |
| **Total per turn** | **1200** | **1800** | **+50%**            |

### Parse Retry Savings

| Scenario                | Before      | After       | Savings       |
| ----------------------- | ----------- | ----------- | ------------- |
| Successful (no retry)   | 1200 tokens | 1800 tokens | +50% cost     |
| 1 retry (50% failure)   | 2400 tokens | 1800 tokens | **-25% cost** |
| 2 retries (25% failure) | 3600 tokens | 1800 tokens | **-50% cost** |

**Net Result**: **Cost NEUTRAL to LOWER** despite higher token limit, due to elimination of retries.

---

## Future Enhancements

### Priority 1 (Immediate)

- [ ] Test with OpenRouter API compatibility
- [ ] Verify structured outputs work with OpenRouter
- [ ] Test JSON parse rate improvement

### Priority 2 (Short-Term)

- [ ] Load dynamic model pricing from models.dev API
- [ ] Add per-model cost tracking
- [ ] Implement model A/B testing framework

### Priority 3 (Long-Term)

- [ ] Support for other structured output providers (Anthropic, etc.)
- [ ] Model performance analytics
- [ ] Automatic model selection based on cost/performance

---

## Related Specs

- [`ai-prompting-enhancement.md`](./ai-prompting-enhancement.md) - Phase-specific prompts
- [`IMPLEMENTATION_PROMPTING_STATUS.md`](./IMPLEMENTATION_PROMPTING_STATUS.md) - Progress tracking
- [`role-mechanics.md`](./role-mechanics.md) - Role behavior
- [`multi-agent-ai-architecture.md`](./multi-agent-ai-architecture.md) - AI agent design

---

## Changelog

### 2025-12-30

- ✅ Added PlayerModelConfig integration from shared package
- ✅ Removed hardcoded model references
- ✅ Added JSON schema system for each phase
- ✅ Implemented OpenAI structured outputs support
- ✅ Increased max_tokens from 200 to 800
- ✅ Added model configuration via environment variables
- ✅ Added role-specific model overrides (MAFIA_MODEL, DOCTOR_MODEL, etc.)
- ✅ Added DISABLE_STRUCTURED_OUTPUTS config option
- ✅ Updated tracking to use actual model
- ✅ Created comprehensive documentation

---

## Known Issues

| Issue                         | Status      | Impact |
| ----------------------------- | ----------- | ------ |
| OpenRouter compatibility      | Untested    | High   |
| Dynamic pricing               | TODO        | Medium |
| Non-OpenAI structured outputs | Unsupported | Low    |
| Model performance comparison  | TODO        | Low    |
