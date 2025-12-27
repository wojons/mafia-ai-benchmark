# Specifications Directory

This directory contains detailed technical specifications for the Mafia AI Benchmark project.

## Specification Files (17 total)

### Core Specifications
- `event-schemas.md` - Event schema definitions with visibility levels (public/private/admin)
- `api-specs.md` - REST API and WebSocket endpoint specifications
- `agent-interface.md` - AgentPolicy interface and behavior contracts
- `database-schema.md` - SQLite schema for game storage
- `cli-interface.md` - CLI command specifications and usage

### Game Mechanics Specifications
- `fsm-states.md` - Finite state machine state transitions (SETUP → NIGHT → DAY → END)
- `role-mechanics.md` - Detailed role behavior (Mafia, Doctor, Sheriff, **Vigilante**, Villagers)
- `vigilante-mechanics.md` - Vigilante role with one-shot mechanic and double-kill resolution
- `suspect-meter.md` - Heuristic scoring algorithm specifications

### AI & Multi-Agent Architecture
- `multi-agent-ai-architecture.md` - Complete AI architecture with:
  - Role-specific prompts (mafia, doctor, sheriff, vigilante, villager)
  - Agent memory and context management
  - Multi-agent communication protocols
  - Three.js visualization architecture
  - Voice synthesis system
  - API and configuration schemas

### Technical Architecture
- `technical-architecture-decisions.md` - **NEW** Complete technical stack decisions:
  - **LLM Providers**: Multi-provider adapter pattern (OpenAI, Anthropic, Google, DeepSeek, Groq, Ollama, LM Studio, Custom)
  - **API Architecture**: REST + WebSocket with complete endpoint specs
  - **CLI Client**: API client with streaming support
  - **Language Stack**: TypeScript 5.x (Node.js backend, React frontend)
  - **Database**: SQLite (better-sqlite3) with complete schema
  - **Visualization**: 2D/3D hybrid approach (Three.js + React Three Fiber)
  - **Asset Generation**: Procedural avatar and environment generation
  - **TTS**: Browser native (free) + External API support (ElevenLabs, OpenAI)
  - **Game State**: Event sourcing + reactive state (hybrid streaming)
  - **Configuration**: Environment variables + config files

### Frontend Specifications
- `ui-components.md` - React component specifications (AgentCard, GameFeed, PhaseHeader, Controls)
- `streaming-protocol.md` - WebSocket event streaming protocol details
- `permission-model.md` - View modes (Admin/Town/Replay) and data filtering

### Implementation Planning
- `implementation-overview.md` - Complete implementation roadmap with 8 phases
- `README.md` - This file

## Role Configuration (Default 10-player)

| Role | Count | Ability | Constraint |
|------|-------|---------|------------|
| Mafia | 3 | Night kill | Coordinate with team |
| Doctor | 1 | Protect | Cannot protect same target twice |
| Sheriff | 1 | Investigate | One per night, private result |
| **Vigilante** | **1** | **One shot** | **Any night, unblockable** |
| Villagers | 4 | Vote/Discuss | No special abilities |

## Usage

These specifications are designed to work with the `PROMPT.md` master prompt. They provide additional implementation details including:

- **Game 2 Insights**: Analysis from a second game transcript showing vigilante mechanics, vote history disputes, mafia busing, and last-minute role reveals
- **Advanced Agent Behaviors**: Vote tracking, defensive storytelling, cross-game memory references
- **Double-Kill Resolution**: How mafia and vigilante actions interact on the same night

## Quick Reference

### Event Types
- `GAME_CREATED`, `PHASE_CHANGED`, `ROLES_ASSIGNED`
- `NIGHT_ACTION_SUBMITTED` (mafia/doctor/sheriff)
- `VIGILANTE_SHOT_SUBMITTED` (new!)
- `NIGHT_RESOLVED` (includes vigilante results)
- `AGENT_THINK_CHUNK` (private), `AGENT_SAY_CHUNK` (public)
- `VOTE_CAST`, `VOTE_CORRECTION` (from Game 2)
- `PLAYER_ELIMINATED`, `GAME_ENDED`

### States
```
SETUP → NIGHT_ACTIONS → MORNING_REVEAL → DAY_DISCUSSION → DAY_VOTING → RESOLUTION → END
                                                    ↑                      ↓
                                                    └──────────────────────┘
```

### View Modes
- **Admin**: Sees all events including THINK streams
- **Town**: Only public events, SAYS statements
- **Replay**: Can toggle reveal to see all