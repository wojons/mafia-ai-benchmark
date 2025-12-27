# Implementation Overview

## Project Status
**Phase:** Specification Complete → Ready for Implementation
**Progress:** 12/12 specification documents created
**Next Step:** Begin Phase 1 - Foundation & Setup

## Implementation Phases

### Phase 1: Foundation & Shared Code
**Priority:** Critical Path
**Duration:** 2-3 days
**Deliverables:**
- Monorepo structure with pnpm workspaces
- TypeScript configuration for all packages
- Shared types and event schemas (strict validation with Zod)
- Game engine FSM core (state machine logic, no I/O)
- Deterministic RNG implementation

**Key Files:**
- `/packages/shared/src/types/events.ts` - All event interfaces
- `/packages/shared/src/types/game.ts` - Game state interfaces
- `/packages/shared/src/engine/fsm.ts` - Finite state machine
- `/packages/shared/src/engine/rng.ts` - Seeded random number generator

**Success Criteria:**
- TypeScript compilation succeeds with strict mode
- FSM can transition through all states
- RNG produces deterministic output given same seed
- 100% test coverage for state transitions

---

### Phase 2: Game Engine Core
**Priority:** Critical Path
**Duration:** 3-4 days
**Deliverables:**
- Complete FSM implementation with all state logic
- Role mechanics (Mafia coordination, Doctor constraints, Sheriff investigations)
- Win condition checking
- Event sourcing reducers
- Snapshot generation

**Key Files:**
- `/packages/shared/src/engine/transitions.ts` - State transition logic
- `/packages/shared/src/roles/ma.ts` - Mafia team coordination
- `/packages/shared/src/roles/doctor.ts` - Doctor protection logic
- `/packages/shared/src/roles/sheriff.ts` - Investigation logic
- `/packages/shared/src/roles/villager.ts` - Villager behaviors

**Success Criteria:**
- Can run complete game loop headlessly
- All role constraints enforced (doctor no-repeat, etc.)
- Events emitted in correct order
- Win conditions accurately detected

---

### Phase 3: Scripted Agents
**Priority:** Critical Path
**Duration:** 4-5 days
**Deliverables:**
- `AgentPolicy` interface implementation
- `ScriptedAgent` base class
- Mafia agent (coordination, deception)
- Doctor agent (protection strategy)
- Sheriff agent (investigation + reveal timing)
- Villager agent (suspicion heuristics)
- Personality variations (aggressive, cautious, analytical)

**Key Files:**
- `/packages/shared/src/agents/interface.ts` - AgentPolicy interface
- `/packages/shared/src/agents/scripted.ts` - Base implementation
- `/packages/shared/src/agents/personalities.ts` - Personality configs
- `/packages/shared/src/agents/strategies/` - Role-specific logic

**Success Criteria:**
- 10 agents can play a full game without errors
- THINK vs SAYS shows believable divergence
- Interesting gameplay emerges (not random)
- Agents make mistakes occasionally (realism)

---

### Phase 4: Backend Server
**Priority:** Critical Path
**Duration:** 4-5 days
**Deliverables:**
- Express.js HTTP server
- WebSocket upgrade handling
- REST API endpoints (create, control, export)
- SQLite storage layer with abstractions
- Event buffering for streaming
- Snapshot management
- Game lifecycle management (create, start, pause, resume, end)

**Key Files:**
- `/apps/server/src/index.ts` - Server entry point
- `/apps/server/src/api/games.ts` - REST endpoints
- `/apps/server/src/stream/websocket.ts` - WebSocket handler
- `/apps/server/src/storage/sqlite.ts` - Database layer
- `/apps/server/src/engine/orchestrator.ts` - Game lifecycle

**Success Criteria:**
- Server starts and binds to port
- REST API responds correctly
- WebSocket connections accepted
- Events persisted to SQLite
- Multiple clients can connect simultaneously

---

### Phase 5: CLI Client
**Priority:** High
**Duration:** 3-4 days
**Deliverables:**
- CLI framework with commands
- `new` command with config options
- `attach` command with live streaming
- `status` command (pretty-printed)
- `pause/resume/step` commands
- `export` command (JSONL output)
- `list` command (game history)
- Authentication token support

**Key Files:**
- `/apps/cli/src/index.ts` - CLI entry
- `/apps/cli/src/commands/new.ts` - Create game
- `/apps/cli/src/commands/attach.ts` - Stream game
- `/apps/cli/src/commands/control.ts` - Pause/resume/step
- `/apps/cli/src/formatters.ts` - Output formatting
- `/apps/cli/src/stream.ts` - WebSocket client

**Success Criteria:**
- `mafiactl new` creates game successfully
- `mafiactl attach` streams events in real-time
- JSON output mode works for scripting
- All commands handle errors gracefully
- Terminal UI is readable and informative

---

### Phase 6: Web Client
**Priority:** High
**Duration:** 5-7 days
**Deliverables:**
- React project with Vite
- AgentCard component (THINK/SAYS split-pane)
- AgentGrid with virtualization
- GameFeed with infinite scroll
- PhaseHeader with animations
- Controls component
- SuspectMeter visualization
- WebSocket client hooks
- Replay viewer with timeline
- Mobile-responsive layout

**Key Files:**
- `/apps/web/src/main.tsx` - React app entry
- `/apps/web/src/components/AgentCard.tsx` - Agent card
- `/apps/web/src/components/AgentGrid.tsx` - Agent grid
- `/apps/web/src/components/GameFeed.tsx` - Event feed
- `/apps/web/src/components/PhaseHeader.tsx` - Phase display
- `/apps/web/src/components/Controls.tsx` - Game controls
- `/apps/web/src/hooks/useGameStream.ts` - WebSocket hook
- `/apps/web/src/hooks/useReplay.ts` - Replay logic

**Success Criteria:**
- Web UI loads in browser
- Real-time updates work smoothly
- THINK vs SAYS clearly visible
- Suspect meter updates in real-time
- Replay mode loads JSONL files
- Mobile layout functional

---

### Phase 7: Testing
**Priority:** High
**Duration:** 3-4 days
**Deliverables:**
- Unit tests for FSM transitions
- Unit tests for win conditions
- Unit tests for role mechanics
- Determinism / replay tests
- Agent behavior tests
- API integration tests
- CLI command tests
- Web component tests

**Key Files:**
- `/tests/engine/fsm.test.ts` - State machine tests
- `/tests/engine/roles.test.ts` - Role mechanic tests
- `/tests/engine/determinism.test.ts` - Replay tests
- `/tests/api/server.test.ts` - API integration tests
- `/tests/cli/commands.test.ts` - CLI tests
- `/tests/web/components.test.tsx` - React component tests

**Success Criteria:**
- >80% code coverage
- All tests pass consistently
- Determinism test proves same seed = same events
- Tests run in CI/CD pipeline

---

### Phase 8: Docker & Deployment
**Priority:** Medium
**Duration:** 2-3 days
**Deliverables:**
- `Dockerfile` for server
- `Dockerfile` for web client
- `docker-compose.yml` for full stack
- Entrypoint scripts
- Volume mounts for persistence
- Environment variable configuration
- README with deployment instructions

**Key Files:**
- `/docker/Dockerfile.server` - Server container
- `/docker/Dockerfile.web` - Web container
- `/docker/docker-compose.yml` - Orchestration
- `/docker/entrypoint.sh` - Startup scripts
- `/.env.example` - Environment variables

**Success Criteria:**
- `docker-compose up` starts everything
- Server and web communicate correctly
- SQLite volume persists data
- Hot reload works for development
- Production build is optimized

---

## Technical Debt & Future Considerations

### Immediate (v1)
- SQLite is sufficient for now (10K games)
- Single-threaded server is okay (game loop is fast)
- No need for horizontal scaling yet
- Authentication is simple token-based

### Soon (v1.1)
- PostgreSQL adapter for storage
- Redis for WebSocket pub/sub
- Proper authentication system
- Rate limiting per IP
- Event compression for bandwidth

### Later (v2)
- Human player slots
- LLM agent adapters
- Plugin system for custom roles
- Tournament mode (multiple games)
- Analytics dashboard
- Video export

---

## Repository Structure

```
mafia-ai-benchmark/
├── apps/
│   ├── server/                # Backend server
│   │   ├── src/
│   │   │   ├── api/           # REST endpoints
│   │   │   ├── stream/        # WebSocket streaming
│   │   │   ├── storage/       # SQLite persistence
│   │   │   ├── engine/        # Game orchestration
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/                   # React web UI
│   │   ├── src/
│   │   │   ├── components/    # React components
│   │   │   ├── hooks/         # Custom hooks
│   │   │   ├── state/         # Context/reducers
│   │   │   └── main.tsx
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── cli/                   # CLI client
│       ├── src/
│       │   ├── commands/      # Command handlers
│       │   ├── ui/            # Terminal UI
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   └── shared/                # Shared code
│       ├── src/
│       │   ├── types/         # TypeScript types
│       │   ├── engine/        # Pure game engine
│       │   ├── agents/        # Agent interfaces
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── docker/                    # Docker files
│   ├── Dockerfile.server
│   ├── Dockerfile.web
│   └── docker-compose.yml
│
├── tests/                     # Test suite
│   ├── engine/
│   ├── api/
│   ├── cli/
│   └── web/
│
├── specs/                     # Specifications
│   ├── README.md
│   ├── event-schemas.md
│   ├── api-specs.md
│   └── ...
│
├── .opencode/                 # Memory bank
│   └── agent/
│       ├── memory-bank.md
│       └── ...
│
├── package.json               # Root package
├── pnpm-workspace.yaml        # Monorepo config
├── PROMPT.md                  # Master prompt
└── README.md                  # User documentation
```

---

## Testing Strategy

### Unit Tests (Fast, Isolated)
```typescript
// Test FSM in isolation
describe('FSM transitions', () => {
  it('should transition from SETUP to NIGHT_ACTIONS', () => {
    const fsm = new GameFSM();
    fsm.initialize(createGameConfig());
    
    expect(fsm.currentState).toBe('NIGHT_ACTIONS');
  });
});

// Test role mechanics
describe('Doctor protection', () => {
  it('cannot protect same target two nights in a row', () => {
    const doctor = new DoctorAgent();
    doctor.protect('p1');  // Night 1
    
    expect(() => doctor.protect('p1')).toThrow();  // Night 2
  });
});
```

### Integration Tests (Moderate)
```typescript
// Test API + Engine
describe('POST /api/games', () => {
  it('creates game and initializes FSM', async () => {
    const res = await request(app)
      .post('/api/games')
      .send({ players: 10, mafia: 3 });
    
    expect(res.status).toBe(200);
    expect(res.body.gameId).toBeDefined();
    
    // Verify game state in database
    const game = await storage.getGame(res.body.gameId);
    expect(game.phase).toBe('SETUP');
  });
});
```

### End-to-End Tests (Slow)
```typescript
// Full game simulation
describe('Deterministic replay', () => {
  it('produces identical events with same seed', async () => {
    const seed = 12345;
    
    // Run game 1
    const game1 = await simulator.runFullGame(seed);
    const events1 = game1.getAllEvents();
    
    // Run game 2
    const game2 = await simulator.runFullGame(seed);
    const events2 = game2.getAllEvents();
    
    // Compare (ignore timestamps)
    const normalize = (events) => events.map(e => ({
      eventType: e.eventType,
      sequence: e.sequence,
      payload: e.payload
    }));
    
    expect(normalize(events1)).toEqual(normalize(events2));
  });
});
```

---

## Risk Mitigation

### Risk 1: Performance Issues with Streaming
**Mitigation:**
- Throttle renders to 30fps
- Virtualize long lists (feed, agent grid)
- Use Web Workers for heavy calculations
- Profile early and often

### Risk 2: Non-Deterministic Behavior
**Mitigation:**
- Strict lint rules (no Math.random() in engine)
- All randomness through seeded RNG
- Fuzz testing with different seeds
- Determinism test in CI

### Risk 3: Complex Agent Behavior
**Mitigation:**
- Start with simple scripted agents
- Add personality variations gradually
- Test agent behaviors in isolation
- Create debug mode to step through agent decisions

### Risk 4: WebSocket Reliability
**Mitigation:**
- Implement auto-reconnect with exponential backoff
- Buffer events on server (last 1000)
- Client can request missed events
- Graceful degradation to polling

---

## Getting Started

After specs are reviewed, begin with:

1. **Setup monorepo:**
   ```bash
   mkdir -p apps/{server,web,cli} packages/shared
   pnpm init (in each)
   pnpm install -D typescript @types/node
   ```

2. **Configure TypeScript:**
   ```bash
   # Root tsconfig.json with references
   echo '{"compilerOptions": {}, "references": [{"path": "./apps/server"}, ...]}' > tsconfig.json
   ```

3. **Create first test:**
   ```bash
   # Test FSM initialization
   cd packages/shared
   pnpm test
   ```

4. **Iterate and build:**
   - Start with shared types
   - Build FSM core
   - Add agents
   - Build server
   - Add CLI
   - Add web UI
   - Test end-to-end

---

## Acceptance Criteria (Definition of Done)

✅ **Core Engine:**
- FSM transitions correctly through all states
- Win conditions detected accurately
- Event stream is deterministic with same seed

✅ **Agents:**
- All 4 roles implemented with scripted behavior
- THINK vs SAYS shows meaningful divergence
- Agents make interesting, non-random decisions

✅ **Server:**
- REST API handles all documented endpoints
- WebSocket streaming works in real-time
- SQLite persistence stores all events
- Multiple simultaneous clients supported

✅ **CLI:**
- All commands work (`new`, `attach`, `status`, `pause`, `resume`, `step`, `export`)
- JSON output mode for scripting
- Pretty-printed output is readable
- Admin mode shows THINK streams

✅ **Web:**
- UI loads and renders correctly
- Real-time updates work smoothly
- THINK vs SAYS split-pane is clear
- Suspect meter updates in real-time
- Replay mode can load JSONL files
- Mobile layout is functional

✅ **Quality:**
- >80% test coverage
- All tests pass in CI
- No linting errors
- TypeScript compilation succeeds
- Docker build succeeds

✅ **Documentation:**
- README with setup instructions
- API documentation
- CLI usage examples
- Architecture overview

---

**Project ready for implementation!** 🎮