# Specifications Directory

This directory contains detailed technical specifications for the Mafia AI Benchmark project.

## ⭐ START HERE - Recommended Reading Order

1. **[Architecture Flows](./architecture-flows.md)** - Comprehensive Mermaid flowcharts showing all system flows
2. **[Split-Pane Consciousness](./split-pane-consciousness.md)** - Core innovation: THINK vs SAYS streams
3. **[Multi-Agent AI Architecture](./multi-agent-ai-architecture.md)** - Complete system architecture

## Specification Files (20 total)

### ⭐ Core Innovation - Split-Pane Consciousness
- **`split-pane-consciousness.md`** - Core architecture enabling:
  - Private THINK stream (internal reasoning, admin only)
  - Public SAYS stream (external statements, all players)
  - Strategic deception (mafia lies in SAYS)
  - Evidence accumulation and case building
  - Behavioral analysis and tracking

### ⭐ Visual Architecture Flows
- **`architecture-flows.md`** - **11 comprehensive Mermaid flowcharts**:
  - High-level game flow
  - Split-pane consciousness flow
  - Night phase flow
  - Day phase flow
  - Voting phase flow
  - Evidence & case building flow
  - Mafia coordination flow
  - Agent decision flow
  - State machine transitions
  - Event sourcing flow
  - Visualization flow

### Core Specifications
- `event-schemas.md` - Event schema definitions with visibility levels (public/private/admin)
- `api-specs.md` - REST API and WebSocket endpoint specifications
- `agent-interface.md` - AgentPolicy interface and behavior contracts (updated for split-pane)
- `database-schema.md` - SQLite schema for game storage
- `cli-interface.md` - CLI command specifications and usage

### Game Mechanics Specifications
- `fsm-states.md` - Finite state machine state transitions (SETUP → NIGHT → DAY → END)
- `role-mechanics.md` - Detailed role behavior (Mafia, Doctor, Sheriff, **Vigilante**, Villagers)
- `vigilante-mechanics.md` - Vigilante role with one-shot mechanic and double-kill resolution
- `suspect-meter.md` - Heuristic scoring algorithm specifications

### AI & Multi-Agent Architecture
- `multi-agent-ai-architecture.md` - Complete AI architecture with:
  - **Split-pane consciousness integration** (THINK/SAYS)
  - Role-specific prompts (mafia, doctor, sheriff, vigilante, villager)
  - Agent memory and context management
  - Multi-agent communication protocols
  - Three.js visualization architecture
  - Voice synthesis system
  - API and configuration schemas

### Technical Architecture
- `technical-architecture-decisions.md` - Complete technical stack:
  - LLM Providers: Multi-provider adapter pattern (8+ supported)
  - API Architecture: REST + WebSocket with complete specs
  - CLI Client: API client with streaming support
  - Language Stack: TypeScript 5.x (Node.js backend, React frontend)
  - Database: SQLite (better-sqlite3)
  - Visualization: 2D/3D hybrid approach (Three.js + React Three Fiber)
  - Asset Generation: Procedural avatar and environment generation
  - TTS: Browser native (free) + External API support (ElevenLabs, OpenAI)
  - Game State: Event sourcing + reactive state (hybrid streaming)
  - Configuration: Environment variables + config files

### Benchmark & Stats System
- `stats-and-scoring-system.md` - Complete stats and benchmarking:
  - Real-time metrics tracking (tokens, API calls, data transfer)
  - Post-game performance scoring (role-specific, action quality, strategy)
  - Model comparison system (win rates, head-to-head, trends)
  - Benchmark report generation (insights, recommendations, exports)
  - Database schema for all stats
  - Stats API endpoints and CLI commands
  - Dashboard visualization components

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

## Key Concept: Split-Pane Consciousness

The fundamental innovation enabling sophisticated AI behavior:

```
┌─────────────────────────────────────────┐
│         AGENT CONSCIOUSNESS             │
├─────────────────────────────────────────┤
│                                         │
│  [THINK]  Private Reasoning             │
│  ───────────────────────────────────   │
│  • True beliefs about other players     │
│  • Private knowledge (role, results)    │
│  • Strategic planning                  │
│  • Fears and concerns                 │
│                                         │
│  Visibility: Admin only                │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│  [SAYS]   Public Statements            │
│  ───────────────────────────────────   │
│  • What agent tells other players      │
│  • Can contain TRUTH or LIES          │
│  • Drives social deduction gameplay    │
│  • Evidence for case building         │
│                                         │
│  Visibility: All players               │
│                                         │
└─────────────────────────────────────────┘

The "insane" part: Agents actively lie in public
while reasoning privately!
```

### Example: Mafia Agent

```
[THINK - Private]
"Player X is actually town, but accusing them will
create confusion and redirect suspicion from our team.
We should coordinate to eliminate Player Y tonight."

[SAYS - Public]  
"I've been watching Player X closely and their
behavior seems suspicious. They asked specific
questions about night actions."
```

## Usage

These specifications provide complete implementation details including:

### New Features (v3.0)
- **Split-pane consciousness system** with THINK/SAYS streams
- **11 comprehensive Mermaid flowcharts** in `architecture-flows.md`
- **Evidence accumulation** and case building system
- **Mafia coordination** with private chat and busing strategies
- **Enhanced voting** with strategic timing and abstention
- **Behavioral analysis** with suspicion scoring

### Game Insights
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
- `EVIDENCE_COLLECTED`, `CASE_BUILT` (new!)

### States
```
SETUP → NIGHT_ACTIONS → MORNING_REVEAL → DAY_DISCUSSION → DAY_VOTING → RESOLUTION → END
                                                    ↑                      ↓
                                                    └──────────────────────┘
```

### View Modes
- **Admin**: Sees all events including THINK streams and evidence
- **Town**: Only public events, SAYS statements, shared evidence
- **Replay**: Can toggle reveal to see all

### New Flow Phases (v3.0)
1. **Evidence Collection**: Agents collect evidence from observations
2. **Case Building**: Agents build cases against players
3. **Case Presentation**: Agents present cases in SAYS stream
4. **Case Response**: Other agents analyze and respond to cases
5. **Behavioral Tracking**: System tracks voting patterns, statement consistency

## Document Relationships

```
architecture-flows.md (⭐ Visual Overview - START HERE)
    ↓
split-pane-consciousness.md (⭐ Core Innovation)
    ↓
multi-agent-ai-architecture.md (Complete Architecture)
    ↓
    ├── fsm-states.md (State Machine)
    ├── event-schemas.md (Events)
    ├── role-mechanics.md (Roles)
    └── agent-interface.md (Implementation)
    
api-specs.md ↔ cli-interface.md (Interfaces)
    ↓
database-schema.md (Data Storage)
    ↓
permission-model.md (Access Control)
    ↓
streaming-protocol.md (Real-time)
    ↓
ui-components.md (Visualization)
    ↓
stats-and-scoring-system.md (Analytics)
```

## Next Steps for Implementation

1. ⭐ **Read**: `architecture-flows.md` for visual understanding
2. ⭐ **Understand**: `split-pane-consciousness.md` for core innovation
3. **Explore**: `multi-agent-ai-architecture.md` for complete details
4. **Implement**: Start with `api-specs.md` and `database-schema.md`
5. **Test**: Build evidence system per `split-pane-consciousness.md`
6. **Benchmark**: Use `stats-and-scoring-system.md` for metrics

## Summary

The Mafia AI Benchmark system v3.0 enables sophisticated multi-agent gameplay with:

✅ **Split-pane consciousness** (THINK private vs SAYS public)  
✅ **Evidence accumulation** and case building  
✅ **Mafia coordination** with private chat and busing  
✅ **Strategic deception** (mafia can lie in SAYS)  
✅ **Behavioral analysis** with suspicion scoring  
✅ **Complete replay** including private reasoning  
✅ **11 visual flowcharts** for easy understanding  
✅ **Comprehensive specifications** for full implementation