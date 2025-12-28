# OpenRouter Models Analysis for Mafia AI Benchmark

## Summary

The OpenRouter models API contains **74 providers** with **1,374+ total models**.

## Key Providers for Mafia AI Benchmark

Based on the analysis, these are the most important providers to support:

### 1. OpenAI (39 models)
**Default Model:** `gpt-5.1`
- GPT-5.1 (391K context, reasoning + tools)
- GPT-5.2 Pro (391K context)
- GPT-4.1 family (1M context, various sizes)

### 2. Anthropic (21 models)
**Default Model:** `claude-sonnet-4`
- Claude Opus 4 (195K context, top-tier reasoning)
- Claude Sonnet 4.5 (977K context)
- Claude Haiku 4.5 (195K context)
- Claude Opus 4.1 (latest)

### 3. Google (26 models)
**Default Model:** `gemini-2.5-pro`
- Gemini 2.5 Pro (1M+ context)
- Gemini 2.5 Flash variants (1M context)
- Gemini 3 Pro/Flash (1M context)

### 4. xAI (22 models)
**Default Model:** `grok-4`
- Grok 4 Fast (2M context, reasoning + tools)
- Grok 4.1 Fast (2M context)
- Grok 4 (250K context)

### 5. Meta (Llama) - via Cloudflare & Amazon Bedrock
**Default Model:** `llama-4-scout`
- Llama 4 Scout (3.4M context on Bedrock)
- Llama 4 Maverick (1M context)
- Llama 3.x family variants

### 6. Alibaba Qwen (100+ models across regions)
**Default Model:** `qwen3-235b-a22b-instruct`
- Qwen 3 Long (9.7M context!)
- Qwen3 Coder Plus (1M context)
- Qwen3 235B variants (256K-1M context)
- Qwen Turbo/Plus/Flash

### 7. Moonshot AI / Kimi (Moonshot AI)
**Default Model:** `kimi-k2-thinking`
- Kimi K2 Thinking (256K-1M context, reasoning)
- Kimi K2 Turbo (256K context)
- Kimi K2 0905 variants

### 8. DeepSeek
**Default Model:** `deepseek-chat`
- DeepSeek R1 Distill (128K context, reasoning)
- DeepSeek V3 variants

### 9. Groq (17 models - fast inference)
**Default Model:** `llama2-70b-4096`
- Llama 3.3 70B Versatile
- Qwen QwQ 32B (reasoning)
- DeepSeek R1 Distill Llama 70B (reasoning)

### 10. Local Providers
- **Ollama** - Local models (llama2, mistral, etc.)
- **LM Studio** - Local models (various)

## Recommended Model List for Mafia AI Benchmark

### Tier 1: Premium Models (Best Performance)
| Provider | Model | Context | Reasoning | Tools | Cost/1M |
|----------|-------|---------|-----------|-------|---------|
| xAI | Grok 4 Fast | 2M | ✅ | ✅ | $0.20/$0.50 |
| Google | Gemini 2.5 Pro | 1M | ✅ | ✅ | $1.25/$10.00 |
| Anthropic | Claude Opus 4 | 195K | ✅ | ✅ | $15.00/$75.00 |
| OpenAI | GPT-5.1 | 391K | ✅ | ✅ | $1.25/$10.00 |
| Meta | Llama 4 Scout | 3.4M | ❌ | ✅ | $0.17/$0.66 |

### Tier 2: High Performance (Good Value)
| Provider | Model | Context | Reasoning | Tools | Cost/1M |
|----------|-------|---------|-----------|-------|---------|
| Alibaba | Qwen3 Long | 9.7M | ❌ | ✅ | $0.07/$0.29 |
| Google | Gemini 2.5 Flash | 1M | ✅ | ✅ | $0.30/$2.50 |
| OpenAI | GPT-4.1 | 1M | ❌ | ✅ | $2.00/$8.00 |
| Moonshot | Kimi K2 Thinking | 256K+ | ✅ | ✅ | $0.55-$1.15 |

### Tier 3: Fast/Efficient
| Provider | Model | Context | Reasoning | Tools | Cost/1M |
|----------|-------|---------|-----------|-------|---------|
| Groq | Llama 3.3 70B | 128K | ❌ | ✅ | $0.59/$0.79 |
| Groq | Qwen QwQ 32B | 128K | ✅ | ✅ | $0.29/$0.39 |
| Groq | DeepSeek R1 Distill | 128K | ✅ | ✅ | $0.75/$0.99 |

### Tier 4: Local/Dev
| Provider | Model | Context | Reasoning | Tools | Cost |
|----------|-------|---------|-----------|-------|------|
| Ollama | llama2 | Varies | ❌ | ❌ | Free |
| LM Studio | llama-2-7b | Varies | ❌ | ❌ | Free |

## Provider Capabilities Summary

| Provider | Streaming | Function Calling | Max Context | Cost Tier |
|----------|-----------|------------------|-------------|-----------|
| OpenAI | ✅ | ✅ | 1M | $$$ |
| Anthropic | ✅ | ❌ | 195K | $$$$$ |
| Google | ✅ | ✅ | 2M | $$ |
| xAI | ✅ | ✅ | 2M | $$ |
| Meta | ✅ | ✅ | 3.4M | $ |
| Qwen | ✅ | ✅ | 9.7M | $ |
| DeepSeek | ✅ | ✅ | 128K | $ |
| Groq | ✅ | ❌ | 256K | $ |
| Ollama | ✅ | ❌ | Varies | Free |
| LM Studio | ✅ | ❌ | Varies | Free |

## Model Naming Conventions

### OpenAI
- `gpt-5.1`, `gpt-5.1-codex`, `gpt-5.2-pro`
- `gpt-4.1`, `gpt-4.1-nano`, `gpt-4.1-mini`

### Anthropic
- `claude-sonnet-4`, `claude-opus-4`, `claude-haiku-4.5`
- `claude-sonnet-3.5-v2`, `claude-opus-4.1`

### Google
- `gemini-2.5-pro`, `gemini-2.5-flash`
- `gemini-3-pro-preview`, `gemini-3-flash`

### xAI
- `grok-4`, `grok-4-fast`, `grok-4.1-fast`

### Meta (Llama)
- `llama-4-scout-17b-16e-instruct`
- `llama-4-maverick-17b-instruct`
- `llama-3.3-70b-versatile`

### Qwen/Alibaba
- `qwen3-235b-a22b-instruct`
- `qwen3-coder-plus`
- `qwen-long` (9.7M context!)

### DeepSeek
- `deepseek-chat`
- `deepseek-r1-distill-llama-70b`

### Groq
- `llama-3.3-70b-versatile`
- `qwen-qwq-32b`
- `deepseek-r1-distill-llama-70b`

## Implementation Priorities

1. **Phase 1:** OpenAI, Anthropic, Google (Tier 1 providers)
2. **Phase 2:** xAI, Meta (Llama), Qwen (Emerging leaders)
3. **Phase 3:** DeepSeek, Groq (Cost-effective options)
4. **Phase 4:** Local providers (Ollama, LM Studio)

## Cost Optimization Strategy

For benchmarking purposes:
- Use **Groq** for rapid iteration (fast, cheap)
- Use **Qwen** for long-context scenarios
- Use **GPT-5.1/Claude Opus 4** for final validation

## Files Generated

- `openrouter_models.json` - Full models API data (812KB)
- `openrouter_models_report.json` - Parsed and organized data
- `scripts/parse_openrouter_models.py` - Parser script

## Next Steps

1. Update `LLMProvider` type to include META, QWEN, MOONSHOT, DEEPSEEK
2. Create provider adapters for remaining providers
3. Add model-specific pricing to `calculateCost()`
4. Update factory with new provider metadata
5. Add model context length validation

---

**Generated:** December 27, 2025  
**Source:** https://models.dev/api.json (OpenRouter Models API)
