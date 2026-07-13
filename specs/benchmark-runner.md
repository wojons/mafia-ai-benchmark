# Benchmark Runner — Mafia AI Benchmark

## Overview

The **BenchmarkRunner** is the orchestration layer that schedules and executes head-to-head AI model matchups in the Mafia AI Benchmark. It sits between the HTTP API layer (`routes/index.ts`) and the existing game infrastructure (GameEngine, AgentCoordinator, StatsCollector, GameRepository), translating a `BenchmarkConfig` into an ordered sequence of games with controlled role rotation, seeded determinism, and progress tracking.

### Position in the architecture

```
POST /api/v1/benchmark  (stubbed, line 855)
         │
         ▼
  BenchmarkRunner        ◄── this service
         │
    ┌────┼────┬────┬────┐
    │    │    │    │    │
    ▼    ▼    ▼    ▼    ▼
 Game  Agent  Stats Game
Engine Coord Collector Repo
         │
         ▼
      EventBus
```

The runner is consumed by the benchmark API endpoint and, in turn, consumes all five `ServerContext` services. It does **not** replace or modify any existing service — it coordinates them.

### Design principles

1. **Non-blocking API**: `start()` returns immediately with a run ID; games execute asynchronously.
2. **Event-driven progress**: The runner subscribes to `EventBus` for `GAME_ENDED` / `WINNER_DETERMINED` events rather than polling.
3. **Deterministic scheduling**: Seeds are allocated monotonically for reproducibility (per `specs/benchmark-methodology.md` §5).
4. **Graceful degradation**: A single game failure does not abort the entire benchmark run.
5. **Observable state**: Every benchmark run exposes its status via a state machine that callers can query.

---

## Dependencies

### Direct dependencies (from `ServerContext`)

| Service | Class / Interface | Import | How the runner uses it |
|---------|-------------------|--------|------------------------|
| GameEngine | `GameEngine` | `./services/game-engine.js` | Creates games (`createGame`), joins baseline players (`joinGame`), and starts them (`startGame`) |
| AgentCoordinator | `AgentCoordinator` | `./services/agent-coordinator.js` | Registers test + baseline agents (`registerAgent`), assigns them to player slots (`assignAgent`) |
| StatsCollector | `StatsCollector` | `./services/stats-collector.js` | Consumed indirectly — game engine and agent coordinator write to it; runner calls `generateReport()` after completion |
| GameRepository | `GameRepository` | `./db/repository.js` | Queries existing games, reads player assignments, verifies game completion status |
| EventBus | `EventBus` | `./services/event-bus.js` | Subscribes to `WINNER_DETERMINED` events to detect game completion without polling |

### Indirect dependencies (used by the above services)

| Dependency | Where it's used |
|-----------|-----------------|
| `GameConfig` (`@mafia/shared/types`) | Default game config passed to GameEngine.createGame |
| `AgentConfig` (`./services/agent-coordinator.ts:24`) | Agent configuration passed to AgentCoordinator.registerAgent |
| `LLMProvider` (`@mafia/shared/types`) | Provider enum for model registration |
| `BenchmarkConfig` (`specs/benchmark-methodology.md`) | Input config shape accepted by the runner |
| `PairingRequirement` (`specs/benchmark-methodology.md`) | Pairing schedule representation |

### Config values the runner reads at construction

The runner reads these from `process.env` or accepts them as constructor options:

| Variable | Default | Description |
|----------|---------|-------------|
| `BENCHMARK_MAX_CONCURRENT_GAMES` | `4` | Maximum number of games to run in parallel |
| `BENCHMARK_DEFAULT_TEMPERATURE` | `0.7` | Temperature for all model calls during benchmark |
| `BENCHMARK_DEFAULT_MAX_TOKENS` | `500` | Max tokens for all model calls during benchmark |
| `BENCHMARK_IDLE_POLL_MS` | `5000` | How often to check for pending games when event-driven notification misses |

---

## Interface

### `BenchmarkRunner` class

```typescript
import {
  BenchmarkConfig,
  BenchmarkStatus,
  BenchmarkProgress,
  BenchmarkRun,
  GamePairing,
  RunSummary,
} from './benchmark-runner.js';  // or @mafia/shared/types

export class BenchmarkRunner {
  /**
   * @param context - The ServerContext containing all required services.
   * @param options - Optional configuration overrides (concurrency, temperature, etc.).
   */
  constructor(
    context: ServerContext,
    options?: BenchmarkRunnerOptions
  );

  /**
   * Start a new benchmark run.
   * Validates the config, schedules pairings, and begins asynchronous execution.
   * Returns immediately with a unique benchmark run ID.
   *
   * @param config - Fully resolved BenchmarkConfig (see specs/benchmark-methodology.md).
   * @returns The ID of the newly created benchmark run.
   * @throws {ValidationError} if config is invalid (empty model list, invalid model names, etc.).
   * @throws {ConflictError} if another benchmark run is already in progress (state is not IDLE).
   */
  start(config: BenchmarkConfig): string;

  /**
   * Cancel a running benchmark. Games in progress are allowed to finish;
   * queued games are discarded. The run transitions to CANCELLED.
   *
   * @param benchmarkId - The ID returned by start().
   * @throws {NotFoundError} if no run exists with that ID.
   * @throws {InvalidStateError} if the run is already COMPLETE, CANCELLED, or FAILED.
   */
  cancel(benchmarkId: string): void;

  /**
   * Get the current lifecycle status of a benchmark run.
   *
   * @param benchmarkId - The ID returned by start().
   * @throws {NotFoundError} if no run exists with that ID.
   */
  getStatus(benchmarkId: string): BenchmarkStatus;

  /**
   * Get detailed progress information for a benchmark run.
   *
   * @param benchmarkId - The ID returned by start().
   * @returns A BenchmarkProgress snapshot or null if the run does not exist.
   */
  getProgress(benchmarkId: string): BenchmarkProgress | null;

  /**
   * List all runs, optionally filtered by status.
   */
  listRuns(status?: BenchmarkRunStatus): BenchmarkRun[];
}
```

### `BenchmarkRunnerOptions`

```typescript
interface BenchmarkRunnerOptions {
  maxConcurrentGames?: number;    // default: 4
  defaultTemperature?: number;    // default: 0.7
  defaultMaxTokens?: number;      // default: 500
  gamesPerPairing?: number;       // default: 10 (from methodology spec)
  idlePollMs?: number;            // default: 5000 (fallback poll interval)
}
```

### Internal methods (not part of public API)

```typescript
// Called by start() to build the pairing schedule
private schedulePairings(config: BenchmarkConfig): GamePairing[];

// Launches a single game for a given pairing + seed
private runGame(pairing: GamePairing, gameIndex: number): Promise<void>;

// Registers agents and assigns them to player slots in a game
private assignPlayers(gameId: string, pairing: GamePairing, seed: number): Promise<void>;

// Called when a game completes — updates progress, checks if run is done
private handleGameComplete(gameId: string): void;

// Persists the final run summary and transitions state
private finalizeRun(benchmarkId: string, status: 'COMPLETE' | 'FAILED'): void;
```

---

## Behavior

### `start(config: BenchmarkConfig): string` — Detailed flow

```
start(config)
  │
  ├─ 1. Validate config
  │     ├─ models[] must have ≥2 entries (or ≥1 if single-model mode)
  │     ├─ Each model string must match /^[\w\/\-.:]+$/ 
  │     ├─ No duplicate model entries
  │     ├─ gameConfig must have exactly 10 players (or configured count)
  │     └─ blockSeed must be a positive integer
  │
  ├─ 2. Check state
  │     └─ If currentRun !== null and status !== COMPLETE|CANCELLED|FAILED → throw ConflictError
  │
  ├─ 3. Generate run ID (uuidv4)
  │
  ├─ 4. Build pairing schedule
  │     ├─ For each unique pair (modelA, modelB) where A.index < B.index:
  │     │   └─ Create GamePairing with 10 game entries
  │     ├─ Each game entry gets a seed: blockSeed + pairingIndex * 10 + gameIndex
  │     └─ Role assignments computed via rotation matrix (see §Role Rotation below)
  │
  ├─ 5. Create and persist BenchmarkRun record
  │
  ├─ 6. Subscribe to EventBus for WINNER_DETERMINED events
  │     └─ Handler: lookup gameId → update pairing.gamesCompleted → check if run complete
  │
  ├─ 7. Kick off async execution
  │     ├─ Start first batch of games (up to maxConcurrentGames)
  │     ├─ Each game: create → assignPlayers → start → (game runs via engine)
  │     └─ When a game completes (via event), launch next queued game
  │
  └─ 8. Return benchmarkId immediately
```

### Game execution sequence (`runGame`)

```
runGame(pairing, gameIndex)
  │
  ├─ 1. Compute seed = pairing.baseSeed + gameIndex
  │
  ├─ 2. Create game via GameEngine.createGame({
  │       config: paired with gameConfig from BenchmarkConfig,
  │       hostName: `benchmark-${pairing.modelA}-vs-${pairing.modelB}-game-${gameIndex+1}`
  │     })
  │
  ├─ 3. Assign players via assignPlayers(gameId, pairing, seed)
  │     ├─ Join 10 players with baseline model
  │     ├─ Overwrite 2 player slots with test models A and B
  │     │   based on role rotation for this gameIndex
  │     ├─ Register agents via AgentCoordinator.registerAgent for each model
  │     └─ Assign agents via AgentCoordinator.assignAgent
  │
  ├─ 4. Store reproducibility metadata
  │     ├─ gameId, blockSeed, personaSeeds, model assignments
  │     ├─ engineCommit, temperature, timestamp
  │     └─ Written to game events or a dedicated benchmark_games table
  │
  ├─ 5. Start game via GameEngine.startGame(gameId)
  │
  └─ 6. Game runs asynchronously via GameEngine's internal FSM
        └─ On WINNER_DETERMINED event → handleGameComplete()
```

### `cancel(benchmarkId: string)` — Detailed flow

```
cancel(benchmarkId)
  │
  ├─ 1. Lookup run; throw NotFoundError if missing
  ├─ 2. Check state is RUNNING or QUEUED; throw InvalidStateError if terminal
  ├─ 3. Mark run status = CANCELLED
  ├─ 4. Clear all queued game entries (not yet started)
  ├─ 5. Unsubscribe from EventBus for this run
  └─ 6. Games already in progress continue to completion (results are discarded or marked)
```

### Role rotation scheme

Per `specs/benchmark-methodology.md` §1.2, each model must experience all roles across the 10-game block. The runner implements this as a deterministic rotation:

```
// 10 games × 2 test model slots = 20 role assignments per pairing.
// The role tuple [modelA_Role, modelB_Role] cycles through:

Game  1: [MAFIA,       VILLAGER    ]    // A as mafia, B as town
Game  2: [MAFIA,       VILLAGER    ]    // Repeat for 2-mafia-player games
Game  3: [DOCTOR,      VILLAGER    ]    // A as doctor
Game  4: [SHERIFF,     VILLAGER    ]    // A as sheriff
Game  5: [VIGILANTE,   VILLAGER    ]    // A as vigilante
Game  6: [VILLAGER,    MAFIA       ]    // B as mafia
Game  7: [VILLAGER,    MAFIA       ]    // Repeat
Game  8: [VILLAGER,    DOCTOR      ]    // B as doctor
Game  9: [VILLAGER,    SHERIFF     ]    // B as sheriff
Game 10: [MAFIA,       VIGILANTE   ]    // A as mafia, B as vigilante (cross-check)
```

The remaining 8 player slots are filled with the **baseline model** (from `BenchmarkConfig.modelConfig.baselineModel`). For a 10-player game with 3 mafia, the rotation fills both test slots first, then the remaining mafia slots with baseline models.

The rotation matrix is derived from the game seed so that running the same block with the same seed always produces the same assignments.

### Event-driven completion detection

The runner subscribes to `EventBus` for events of type `WINNER_DETERMINED`. When a game completes:

1. The handler looks up which pairing and game index the `gameId` belongs to.
2. It marks that game as completed in the pairing's `gamesCompleted` counter.
3. It records the winner for head-to-head tracking.
4. If the pairing has met `minGames`, the runner checks whether **all** pairings are complete.
5. If all pairings are complete → transition to `COMPLETE`.
6. If some remain, dequeue and launch the next game from a pending pairing.

**Fallback polling**: If the event bus notification is missed (process restart, subscription race), the runner also maintains a 5-second interval timer that checks the `GameRepository` for unexpected `ENDED` status on any benchmark-launched game.

### Baseline model management

Non-test player slots are filled with a **baseline model** specified in `BenchmarkConfig.modelConfig.baselineModel` (e.g., `"neuralwatt:qwen3.6-35b-fast"`). The runner:

1. Registers a single `AgentPolicy` for the baseline model on first use (reuses across all games in the run).
2. For each game, joins 8 baseline players (or N-2 for the configured player count) via `GameEngine.joinGame()`, then assigns the baseline agent to each via `AgentCoordinator.assignAgent()`.
3. Does **not** re-register the baseline agent for every game — existing agents are retained across the run.

---

## Data

### `BenchmarkRun`

```typescript
interface BenchmarkRun {
  /** Unique run identifier (uuidv4). */
  id: string;

  /** The config used to start this run. */
  config: BenchmarkConfig;

  /** Current lifecycle status. */
  status: BenchmarkRunStatus;

  /** ISO 8601 timestamp of when start() was called. */
  createdAt: string;

  /** ISO 8601 timestamp of when status became COMPLETE, CANCELLED, or FAILED. */
  completedAt?: string;

  /** The scheduled pairings for this run. */
  pairings: GamePairing[];

  /** Optional summary populated when the run reaches a terminal state. */
  summary?: RunSummary;

  /** Error message if status is FAILED. */
  error?: string;

  /** ISO 8601 timestamp of last status change. */
  updatedAt: string;
}
```

### `BenchmarkRunStatus`

```typescript
type BenchmarkRunStatus =
  | 'QUEUED'        // Created, not yet started
  | 'RUNNING'       // At least one game in progress
  | 'COMPLETE'      // All pairings have met their minGames
  | 'CANCELLED'     // Cancelled by user — partial results available
  | 'FAILED';       // Irrecoverable error — see error field
```

### `GamePairing`

```typescript
interface GamePairing {
  /** Unique pairing identifier within the run: `${runId}:${modelA}:${modelB}`. */
  id: string;

  /** First test model (fully qualified, e.g., "neuralwatt:qwen3.6-35b-fast"). */
  modelA: string;

  /** Second test model. */
  modelB: string;

  /** Minimum games required (from methodology spec: 10). */
  minGames: number;

  /** Number of completed games in this pairing. */
  gamesCompleted: number;

  /** Total queued games for this pairing (usually === minGames). */
  totalGames: number;

  /** Base seed for this pairing; individual game seeds = baseSeed + index. */
  baseSeed: number;

  /** Role assignment for each game in this pairing. Index matches game index. */
  roleAssignments: RoleAssignment[];

  /** Per-game results (null if not yet played). */
  games: (GameResult | null)[];

  /** Current status of this pairing. */
  status: PairingStatus;
}

type PairingStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'PARTIAL_FAILURE';

interface RoleAssignment {
  /** Role model A plays in this game. */
  modelARole: RoleType;

  /** Role model B plays in this game. */
  modelBRole: RoleType;
}

interface GameResult {
  /** The game ID from GameEngine / GameRepository. */
  gameId: string;

  /** Seed used for this specific game. */
  seed: number;

  /** Which model won ('A' | 'B' | 'DRAW'). */
  winner: 'A' | 'B' | 'DRAW';

  /** The actual team that won ('MAFIA' | 'TOWN'). */
  teamWinner: 'MAFIA' | 'TOWN';

  /** Duration in milliseconds. */
  durationMs: number;

  /** ISO 8601 timestamp when the game ended. */
  completedAt: string;

  /** Error message if the game partially failed. */
  error?: string;

  /** Whether this game's results are valid for inclusion. */
  valid: boolean;
}
```

### `BenchmarkStatus`

```typescript
interface BenchmarkStatus {
  /** Current lifecycle state of the run. */
  status: BenchmarkRunStatus;

  /** Total number of pairings in this run. */
  totalPairings: number;

  /** Number of pairings that have met minGames. */
  completedPairings: number;

  /** Summary of game-level progress. */
  progress: BenchmarkProgress;

  /** Elapsed time since creation (milliseconds). */
  elapsedMs: number;

  /** Snapshot of when this status was generated. */
  timestamp: string;
}
```

### `BenchmarkProgress`

```typescript
interface BenchmarkProgress {
  /** Games that have been created and assigned but not yet started. */
  queued: number;

  /** Games currently being executed by GameEngine. */
  running: number;

  /** Games that finished with a valid result. */
  completed: number;

  /** Games that finished with an error (invalid results). */
  failed: number;

  /** Games that were cancelled before starting. */
  cancelled: number;

  /** Total games across all pairings. */
  total: number;

  /** Completion percentage (0–100). */
  percentComplete: number;  // Math.round((completed / total) * 100)

  /** Estimated remaining time in milliseconds (based on average game duration). */
  estimatedRemainingMs?: number;
}
```

### `RunSummary`

```typescript
interface RunSummary {
  /** Benchmark run ID. */
  runId: string;

  /** Wall-clock duration from start to completion. */
  totalDurationMs: number;

  /** Total games played (only valid ones). */
  totalGamesPlayed: number;

  /** Total games that failed. */
  totalGamesFailed: number;

  /** Per-pairing results. */
  pairings: Array<{
    modelA: string;
    modelB: string;
    gamesPlayed: number;
    modelAWins: number;
    modelBWins: number;
    draws: number;
    modelAWinRate: number;
    modelBWinRate: number;
  }>;

  /** Per-model aggregate stats across all pairings. */
  modelStats: Array<{
    model: string;
    totalGames: number;
    totalWins: number;
    totalLosses: number;
    winRate: number;
  }>;

  /** Whether all pairings met the minimum game threshold. */
  metMinimumThreshold: boolean;

  /** ISO 8601 timestamp. */
  completedAt: string;
}
```

### Database schema additions

The runner requires one new table to persist run state across restarts:

```sql
CREATE TABLE IF NOT EXISTS benchmark_runs (
  id TEXT PRIMARY KEY,
  config TEXT NOT NULL,           -- JSON serialized BenchmarkConfig
  status TEXT NOT NULL DEFAULT 'QUEUED',  -- QUEUED|RUNNING|COMPLETE|CANCELLED|FAILED
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  summary TEXT,                   -- JSON serialized RunSummary
  error TEXT
);

CREATE TABLE IF NOT EXISTS benchmark_pairings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES benchmark_runs(id),
  model_a TEXT NOT NULL,
  model_b TEXT NOT NULL,
  min_games INTEGER NOT NULL DEFAULT 10,
  games_completed INTEGER NOT NULL DEFAULT 0,
  total_games INTEGER NOT NULL DEFAULT 10,
  base_seed INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  FOREIGN KEY (run_id) REFERENCES benchmark_runs(id)
);

CREATE TABLE IF NOT EXISTS benchmark_games (
  game_id TEXT PRIMARY KEY,
  pairing_id TEXT NOT NULL REFERENCES benchmark_pairings(id),
  run_id TEXT NOT NULL REFERENCES benchmark_runs(id),
  seed INTEGER NOT NULL,
  model_a_role TEXT NOT NULL,
  model_b_role TEXT NOT NULL,
  winner TEXT,                    -- 'A' | 'B' | 'DRAW' | NULL
  team_winner TEXT,              -- 'MAFIA' | 'TOWN' | NULL
  duration_ms INTEGER,
  completed_at INTEGER,
  error TEXT,
  valid INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (game_id) REFERENCES games(id)
);
```

---

## States

### State machine

```
                   start(config)
  ┌─────────┐  ──────────────────  ┌──────────┐
  │  IDLE   │                      │  QUEUED   │
  └─────────┘                      └─────┬────┘
       ▲                                  │
       │                        async execution begins
       │                                  ▼
       │                            ┌──────────┐
       │            cancel() ──────▶│ RUNNING  │
       │                            └─────┬────┘
       │                                  │
       │                          ┌───────┴────────┐
       │                          │                │
       │                     all games         irrecoverable
       │                     complete            error
       │                          │                │
       │                          ▼                ▼
       │                    ┌──────────┐    ┌──────────┐
       │                    │ COMPLETE │    │  FAILED  │
       │                    └──────────┘    └──────────┘
       │
       └──── cancel() during QUEUED ──────▶ CANCELLED
       └──── cancel() during RUNNING ─────▶ CANCELLED
```

### Transition rules

| From | To | Trigger |
|------|----|---------|
| IDLE | QUEUED | `start()` called with valid config |
| QUEUED | RUNNING | First game begins execution (asynchronous) |
| QUEUED | CANCELLED | `cancel()` called before any game starts |
| RUNNING | COMPLETE | All pairings have `gamesCompleted >= minGames` |
| RUNNING | CANCELLED | `cancel()` called during active execution |
| RUNNING | FAILED | Irrecoverable error (engine crash, database failure, config corruption) |
| COMPLETE | (terminal) | No transitions out |
| CANCELLED | (terminal) | No transitions out |
| FAILED | (terminal) | No transitions out |

### Concurrency safety

The runner uses a mutex (or async queue) on the benchmark run's internal state to prevent race conditions between the `handleGameComplete` event handler and the game-launch loop. The `cancel()` method acquires this mutex before reading/writing state.

---

## Errors

The runner defines a catalog of error scenarios. All errors extend a base `BenchmarkError`:

```typescript
class BenchmarkError extends Error {
  constructor(
    message: string,
    public readonly code: BenchmarkErrorCode,
    public readonly benchmarkId?: string
  );
}

type BenchmarkErrorCode =
  | 'VALIDATION_ERROR'
  | 'CONFLICT_ERROR'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'GAME_CREATION_FAILED'
  | 'MODEL_ASSIGNMENT_FAILED'
  | 'GAME_CRASHED'
  | 'DATABASE_ERROR'
  | 'ENGINE_BUSY'
  | 'TIMEOUT';
```

### Error catalog (6+ distinct scenarios)

#### E1. Validation: empty or invalid model list

- **Trigger**: `start()` called with `config.models` having 0 or 1 entries (in head-to-head mode), or entries that don't match the model name regex.
- **Behavior**: `start()` throws `BenchmarkError` with code `VALIDATION_ERROR` immediately. No run is created.
- **Recovery**: The API layer returns a 400 with the validation message. User must fix config and retry.

#### E2. Conflict: benchmark already running

- **Trigger**: `start()` called while an existing run is still in `QUEUED` or `RUNNING` state.
- **Behavior**: `start()` throws `BenchmarkError` with code `CONFLICT_ERROR`. The existing run is unaffected.
- **Recovery**: API layer returns 409. User must `cancel()` the existing run or wait for it to complete.

#### E3. Game engine fails to create a game

- **Trigger**: `GameEngine.createGame()` throws or returns an invalid game (database full, config mismatch).
- **Behavior**: The runner catches the error, marks the specific game entry as `{ valid: false, error: "..." }`, increments `failed` counter, and proceeds to the next game in the pairing. If the failure rate exceeds 50% across the run, the run transitions to `FAILED`.
- **Recovery**: The pairing is marked `PARTIAL_FAILURE`. The run finishes with fewer than 10 valid games for that pairing. Results are annotated with "†" (fewer than minimum games).

#### E4. Model assignment failure (agent registration)

- **Trigger**: `AgentCoordinator.registerAgent()` or `assignAgent()` fails because the model identifier is invalid, API key is missing, or provider is unreachable.
- **Behavior**: The runner catches the error, cancels the specific game (marks it failed), and logs the model name. The pairing's remaining scheduled games for that model are also marked failed immediately if the model is unreachable (fail-fast for a dead model across all pairings).
- **Recovery**: Operator is notified via log. The model is excluded from further scheduling in this run. Partial results for other pairings are retained.

#### E5. Game crashes mid-execution

- **Trigger**: A game enters an invalid state or the GameEngine's FSM throws an unhandled exception.
- **Behavior**: The `EventBus` subscription does not fire (no `WINNER_DETERMINED` event). The fallback poller detects the game has been running longer than a configurable timeout (default: 30 minutes) and marks it as failed.
- **Recovery**: The game is marked `{ valid: false, error: "Game timed out after 30m" }`. The pairing continues with remaining games. The game's partial data (events up to crash point) remains in the database for forensic analysis.

#### E6. Partial completion handling

- **Trigger**: A benchmark run reaches terminal state (CANCELLED or FAILED) with some pairings having 0–9 valid games instead of the required 10.
- **Behavior**: The run's `summary` includes all partial results. Pairings with <10 games are flagged (`metMinimumThreshold: false`). The existing StatsCollector report infrastructure naturally handles partial data because it aggregates whatever games exist.
- **Recovery**: Results are marked with the "†" annotation (fewer than 10 games) per methodology spec §4.4. No data is discarded.

#### E7. Duplicate model in pairing

- **Trigger**: `BenchmarkConfig.models` contains the same model identifier twice.
- **Behavior**: `start()` throws `VALIDATION_ERROR` during config validation (step 1). Self-play comparisons are meaningless and would waste compute.
- **Recovery**: Deduplicate the model list input on the client side before submitting.

#### E8. Database persistence failure

- **Trigger**: Writing benchmark run state to `benchmark_runs` or `benchmark_games` table fails (disk full, schema mismatch, constraint violation).
- **Behavior**: The runner wraps all writes in try/catch. If the initial write for a new run fails, `start()` throws `DATABASE_ERROR`. If a mid-run write fails (e.g., saving a game result), the runner logs the error and retries once. On second failure, the run transitions to `FAILED`.
- **Recovery**: The in-memory run state is preserved for the lifetime of the process. On restart, incomplete runs are loaded from the database (if any state was persisted before the failure).

---

## Testing

### Test setup

```typescript
// All tests use a mocked or in-memory ServerContext
function createMockContext(): ServerContext {
  return {
    gameEngine: mock(GameEngine),
    agentCoordinator: mock(AgentCoordinator),
    eventBus: new EventBus(),      // real EventBus for event-driven testing
    statsCollector: mock(StatsCollector),
    gameRepository: mock(GameRepository),
  };
}
```

### Test scenarios (5+ required)

#### T1. Unit test: scheduling logic produces correct pairings

- **Input**: `models = ["provider:a", "provider:b", "provider:c"]`, `gamesPerPairing = 10`
- **Expected**: `schedulePairings()` returns 3 pairings: (a,b), (a,c), (b,c). Each pairing has 10 game entries with monotonically increasing seeds. Role assignments cycle through the rotation matrix.
- **Edge case**: Single model in `models` array → throws `VALIDATION_ERROR`.

#### T2. Unit test: role rotation covers all roles

- **Input**: Single pairing (modelA, modelB) with 10 game entries.
- **Expected**: Across the 10 assignments for each model, every non-dictator role (MAFIA, DOCTOR, SHERIFF, VIGILANTE, VILLAGER) appears at least once. Model A and B have different assignments per game.
- **Verify**: `roleAssignments` array shows the correct rotation per the methodology spec §1.2.

#### T3. Integration test: single-game run completes successfully

- **Input**: `BenchmarkConfig` with 2 models, 1 game per pairing (override `gamesPerPairing` to 1 for test speed).
- **Expected**: `start()` returns a run ID. The `getStatus()` transitions QUEUED → RUNNING → COMPLETE. `getProgress()` shows `completed: 1, total: 1`. Run summary contains valid game result with winner.
- **Verify**: Spy on `GameEngine.createGame`, `AgentCoordinator.registerAgent`, and `GameEngine.startGame` to confirm each was called with the expected arguments.

#### T4. Integration test: cancel mid-run

- **Input**: `BenchmarkConfig` with 2 pairings, 10 games each. Set `maxConcurrentGames = 2` to ensure sequential-like behavior. Call `cancel()` after the first game completes.
- **Expected**: The run transitions to `CANCELLED`. `getProgress()` shows some completed (≥1) and the rest cancelled. The summary contains valid partial results from completed games.
- **Verify**: No new games are created after `cancel()` returns. Games already in progress before `cancel()` are allowed to finish.

#### T5. Edge case: empty model list

- **Input**: `BenchmarkConfig` with `models = []`.
- **Expected**: `start()` throws `BenchmarkError` with code `VALIDATION_ERROR`. No run is created.
- **Verify**: All run-listing functions return empty. Database has no new rows.

#### T6. Edge case: duplicate models

- **Input**: `BenchmarkConfig` with `models = ["provider:a", "provider:a"]`.
- **Expected**: `start()` throws `VALIDATION_ERROR` with a message about duplicate models.
- **Verify**: Same as T5 — no run created.

#### T7. Edge case: game engine failure recovery

- **Input**: `BenchmarkConfig` with 2 models, 5 games. Inject a mock that causes `GameEngine.createGame()` to throw on the third game.
- **Expected**: The first 2 games complete normally. The third game is marked `failed`. Games 4 and 5 proceed. The pairing's `status` is `PARTIAL_FAILURE`. The run transitions to `COMPLETE` (not `FAILED`) because the failure rate is under 50%.
- **Verify**: 4 of 5 games completed, 1 failed. Summary does not include the failed game in stats.

#### T8. Integration test: full head-to-head report

- **Input**: Run a complete benchmark with 3 models, 2 games per pairing (6 total games).
- **Expected**: After completion, `StatsCollector.generateReport()` returns data that includes all 3 models. The head-to-head entries in `getCompareReport()` reflect the games played.
- **Verify**: Cross-reference pairing results from RunSummary with StatsCollector output.

---

## Security

### Input validation

All user-supplied fields in `BenchmarkConfig` are validated before any work begins:

| Field | Validation | Reject if |
|-------|-----------|-----------|
| `models[]` | Array of strings matching `/^[\w\/\-.:]+$/` | Empty, contains regex-special chars, too many entries (>100) |
| `blockSeed` | Positive integer | Negative, zero, non-integer |
| `personaSeeds[]` | Array of strings, max 50 chars each | Empty array, contains null bytes |
| `gameConfig.playerCount` | Integer, 5–12 | Outside range |
| `modelConfig.temperature` | Float, 0.0–1.0 | Outside range |
| `modelConfig.maxTokens` | Integer, 100–32000 | Outside range |
| `modelConfig.baselineModel` | Non-empty string matching model regex | Empty or invalid |

### API key safety

- The runner never reads, stores, or logs API keys. API keys are managed by the `AgentCoordinator` and provider infrastructure.
- Model identifiers are sanitized for logging — any non-alphanumeric characters beyond `/`, `-`, `.`, `:` are stripped before writing to logs.
- The `BenchmarkConfig` is **not** passed user API keys as part of its configuration.

### Rate limiting & abuse prevention

- Maximum concurrent games is capped (configurable, default 4, max 16).
- Maximum total models in a single benchmark run is capped at 50 (prevents combinatorial explosion: 50 models = 1,225 pairings × 10 games = 12,250 games).
- A minimum 5-second delay between game launches within the same pairing (prevents rapid-fire API calls on game creation).

### Run isolation

- Each benchmark run's games are tagged in the database with the run ID.
- No cross-run side effects: games from different runs use independent seed spaces.
- A `cancel()` operation only affects games within the specified run ID.

---

## Performance

### Concurrency model

**Within a pairing**: Games run **sequentially**. Per the methodology spec §6.3, games within a pairing block share seeds and control variables — running them in parallel would break determinism.

**Across pairings**: Games can run **in parallel** since each pairing uses an independent seed space. The runner maintains a configurable worker pool:

```
maxConcurrentGames: 4  (default, configurable via options or BENCHMARK_MAX_CONCURRENT_GAMES)
```

The runner's game-launch loop works as follows:

```
1. Seed the game-launch queue with all pending pairings
2. While queue is not empty and activeCount < maxConcurrentGames:
     a. Pick the pairing with the fewest completed games (round-robin fairness)
     b. Launch its next pending game asynchronously
     c. Increment activeCount
3. When a game completes (via EventBus):
     a. Decrement activeCount
     b. Update pairing progress
     c. If pairings remain incomplete → goto 2 (launch next)
     d. Else → transition to COMPLETE
```

### Resource limits

| Resource | Limit | Enforcement |
|----------|-------|-------------|
| Max concurrent games | 4 (configurable, max 16) | Worker pool semaphore |
| Max models per run | 50 | Config validation (prevents 50+ model combos) |
| Max games per pairing | 100 | Hard cap on `totalGames` field |
| Max runtime per game | 30 minutes | Timer in fallback poller — marks timed-out games as failed |
| Max total runtime per run | N/A | Determined by pairing count × game duration |
| Memory per run | ~50KB per 100 games | In-memory pairing schedule and progress state |

### Database impact

- Each game inserts 1 row into `benchmark_games`.
- Each run inserts 1 row into `benchmark_runs` + N rows into `benchmark_pairings` (one per pairing).
- For 100 pairings × 10 games = 1,000 rows: negligible load (<10MB total).
- The runner does **not** perform heavy queries during game execution. Status reads are cheap index lookups.

### Startup cost

- Config validation: O(n) for n models in the config (negligible).
- Pairing schedule generation: O(n²) for n models (91 pairings for 14 models — fast, purely in-memory).
- Agent registration: O(n) per model, done once per model per run.

### Worst-case estimates

| Scenario | Pairings | Games | Sequential | 4-way parallel | 8-way parallel |
|----------|----------|-------|-----------|----------------|----------------|
| 5 Tier-1 models | 10 | 100 | ~8 h | ~2 h | ~1 h |
| All 14 models | 91 | 910 | ~76 h | ~19 h | ~10 h |
| 25 models (cap) | 300 | 3,000 | ~10 d | ~2.5 d | ~1.25 d |

*(Assumes ~5 min average game duration from methodology spec §6.3.)*

### Connection pooling

- The runner creates one `AgentPolicy` per unique model per run. These are shared across all games that use the same model.
- Agent configurations (temperature, maxTokens) are set once during registration and reused.
- No additional database connections beyond what `GameRepository` already provides.

---

## References

- **Benchmark Methodology**: `specs/benchmark-methodology.md` — defines `BenchmarkConfig`, `PairingRequirement`, role rotation scheme, minimum games, Elo system, and reproducibility.
- **Stats & Scoring System**: `specs/stats-and-scoring-system.md` — defines `StatsCollector`, `TokenMetrics`, `APIMetrics`, `PerformanceScorer`, `ModelComparisonEngine`, `BenchmarkReport`.
- **Server Architecture**: `apps/server/src/index.ts` — defines `ServerContext` interface with all five service dependencies.
- **Game Engine**: `apps/server/src/services/game-engine.ts` — `createGame()`, `joinGame()`, `startGame()`.
- **Agent Coordinator**: `apps/server/src/services/agent-coordinator.ts` — `registerAgent()`, `assignAgent()`, `executeAgent()`.
- **Event Bus**: `apps/server/src/services/event-bus.ts` — `subscribe()`, `emit()`.
- **Game Repository**: `apps/server/src/db/repository.ts` — database operations for games, players, events.
- **Stats Collector**: `apps/server/src/services/stats-collector.ts` — `generateReport()`, `getCompareReport()`, `getMatchups()`.
- **Shared Types**: `packages/shared/src/types/index.ts` — `Game`, `Player`, `RoleType`, `GameConfig`, `GameStats`.
