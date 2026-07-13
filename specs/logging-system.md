# Logging System Specification

## Overview

A comprehensive, structured logging system for the Mafia AI Benchmark server. This system replaces ad-hoc `console.log` calls with a centralized `LoggerService` that supports structured JSON output, multiple transports, correlation IDs for distributed tracing, game-event/system-log separation, and performance-optimized async writes.

The logging system integrates with the existing `EventBus` (see `apps/server/src/services/event-bus.ts`) so that every `GameEvent` published through the bus is also recorded as a structured log entry with full context — no dual-write required from callers.

This spec extends the existing architecture:
- **Type system**: Uses `LogLevel` from `packages/shared/src/types/index.ts` (`'DEBUG' | 'INFO' | 'WARN' | 'ERROR'`)
- **EventBus**: `EventBus` in `apps/server/src/services/event-bus.ts` (`publish`, `subscribeAll`)
- **Database**: SQLite via `better-sqlite3`, schema in `apps/server/src/db/schema.sql`
- **Server**: Express + WebSocket + SSE in `apps/server/src/index.ts`

---

## 1. Log Levels & Per-Component Filtering

### 1.1 Log Level Hierarchy

```
DEBUG (0) → INFO (1) → WARN (2) → ERROR (3) → FATAL (4)
```

Log levels align with the existing `LogLevel` type, plus `FATAL` for unrecoverable errors:

```typescript
// Already exists in @mafia/shared/types:
// export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// Extension for the logging system:
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
};
```

### 1.2 Level Semantics

| Level | Meaning | Example Usage |
|-------|---------|---------------|
| **DEBUG** | Detailed diagnostic info. Verbose, only enabled during development or per-component troubleshooting. | Agent prompt construction, vote tally internals, WebSocket frame details |
| **INFO** | Normal operational events. The default production level. | Game created, phase changed, agent turn started, HTTP request completed |
| **WARN** | Potentially problematic but non-fatal. | Retry on LLM API, vote timeout approaching, rate limit near threshold |
| **ERROR** | Errors that affect a specific operation but not server health. | LLM API call failed, malformed agent response, event handler threw exception |
| **FATAL** | Unrecoverable errors that prevent server operation. | Database corruption, port binding failure, out of memory |

### 1.3 Component Filtering

Components are named using dot-notation to allow hierarchical filtering:

```typescript
export type ComponentName =
  // Core game components
  | 'game-engine'
  | 'game-engine.fsm'
  | 'game-engine.night'
  | 'game-engine.day'
  | 'game-engine.voting'
  | 'game-engine.resolution'
  // Agent components
  | 'agent-coordinator'
  | 'agent-coordinator.llm'
  | 'agent-coordinator.prompt'
  | 'agent-coordinator.memory'
  // Server components
  | 'server'
  | 'server.http'
  | 'server.websocket'
  | 'server.sse'
  // Infrastructure
  | 'event-bus'
  | 'stats-collector'
  | 'database'
  | 'database.migration'
  | 'database.query'
  // External services
  | 'llm-provider'
  | 'llm-provider.openai'
  | 'llm-provider.anthropic'
  | string; // Extensible
```

**Filtering config** (via environment or `GameConfig.logLevel`):

```typescript
export interface LogFilterConfig {
  // Global minimum level. Default: 'INFO' in production, 'DEBUG' in development.
  globalLevel: LogLevel;

  // Per-component overrides. Components inherit their parent's level
  // unless explicitly overridden. Wildcards and prefix matching supported.
  // Example: 'agent-coordinator.*' matches all agent sub-components.
  componentLevels: Record<string, LogLevel>;
}
```

**Inheritance example**:
```typescript
const filterConfig: LogFilterConfig = {
  globalLevel: 'WARN',                          // Only WARN+ from most components
  componentLevels: {
    'game-engine': 'INFO',                      // INFO+ for game engine
    'game-engine.voting': 'DEBUG',              // DEBUG for voting internals
    'agent-coordinator.llm': 'DEBUG',           // DEBUG for LLM prompt details
    'server.http': 'ERROR',                     // ERROR only for HTTP middleware
    'llm-provider.*': 'INFO',                   // INFO+ for all LLM providers
  },
};
```

**Level determination algorithm**:
```typescript
function getComponentLevel(
  component: string,
  config: LogFilterConfig
): LogLevel {
  // 1. Check exact component match
  if (config.componentLevels[component]) {
    return config.componentLevels[component];
  }
  // 2. Walk up parent components (dot-separated)
  const parts = component.split('.');
  while (parts.length > 0) {
    const prefix = parts.join('.');
    const wildKey = prefix + '.*';
    if (config.componentLevels[wildKey]) {
      return config.componentLevels[wildKey];
    }
    parts.pop();
  }
  // 3. Fall back to global
  return config.globalLevel;
}
```

---

## 2. Structured JSON Output

### 2.1 Base Log Entry Schema

Every log entry is a single JSON object with the following schema:

```typescript
export interface LogEntry {
  /** ISO 8601 timestamp with millisecond precision */
  timestamp: string;              // "2025-06-09T11:30:45.123Z"

  /** Log severity level */
  level: LogLevel;                // "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL"

  /** Component producing the log (dot-notation) */
  component: string;              // "game-engine.voting"

  /** Human-readable log message (always present, no interpolation) */
  message: string;                // "Vote cast: p1 voted against p2"

  // --- Optional contextual fields ---

  /** Game ID when the log relates to a specific game */
  gameId?: string;                // "game-abc123"

  /** Player ID when the log relates to a specific player/agent */
  playerId?: string;              // "p2"

  /** Turn number within the game */
  turnNumber?: number;             // 14

  /** Day number within the game */
  dayNumber?: number;              // 3

  /** The game phase when the log was emitted */
  phase?: GamePhase;              // "DAY_VOTING"

  /** Correlation ID for end-to-end traceability (see §4) */
  correlationId?: string;         // "corr-x7k2m9"

  /** The event type if this log is from EventBus integration */
  eventType?: string;             // "VOTE_CAST"

  /** Arbitrary structured data payload */
  data?: Record<string, unknown>;

  // --- Internal metadata (not for display) ---

  /** Source file and line (only present at DEBUG) */
  source?: string;                // "game-engine.ts:342"

  /** Process ID */
  pid: number;

  /** Hostname */
  hostname: string;

  /** Log category: 'system' or 'game' (see §5) */
  category: 'system' | 'game';
}
```

### 2.2 JSON Output Example

```json
{
  "timestamp": "2025-06-09T11:30:45.123Z",
  "level": "INFO",
  "component": "game-engine.voting",
  "message": "Vote cast: p1 (Alice) voted against p2 (Bob)",
  "gameId": "game-abc123",
  "playerId": "p1",
  "turnNumber": 14,
  "dayNumber": 3,
  "phase": "DAY_VOTING",
  "correlationId": "corr-x7k2m9",
  "eventType": "VOTE_CAST",
  "data": {
    "voterId": "p1",
    "targetId": "p2",
    "voteCount": 4,
    "totalAlive": 7
  },
  "pid": 28461,
  "hostname": "helios-server",
  "category": "game"
}
```

### 2.3 Message Guidelines

- Messages are **static strings** — no runtime interpolation. Pass dynamic data via the `data` field.
- Messages use a **subject-verb-object** pattern: `"Game created: {gameId} with {count} players"`
- Error messages include the **operation that failed**: `"LLM API call failed for agent p3 in game-abc"`, with error details in `data`.
- Messages **never leak sensitive data** (API keys, full prompts with keys). Those go to `data` with redaction applied at DEBUG level only.

---

## 3. Transports

The logger supports multiple simultaneous transports. Each transport receives every log entry and applies its own filtering and formatting.

### 3.1 Stdout Transport (Human-Readable, Colored)

**Format**: Colored, line-oriented console output for development and `docker logs`.

**Color scheme** (ANSI):
| Level  | Color  | Prefix |
|--------|--------|--------|
| DEBUG  | Gray   | `[DEBUG]` |
| INFO   | Green  | `[INFO ]` |
| WARN   | Yellow | `[WARN ]` |
| ERROR  | Red    | `[ERROR]` |
| FATAL  | Red bg | `[FATAL]` |

**Output format**:
```
[TIMESTAMP] [LEVEL] [COMPONENT] [GAME:gameId] [CORR:xxx] message { data }
```

**Examples**:
```
[11:30:45.123] [INFO ] [game-engine.voting] [GAME:game-abc] Vote cast: p1 voted for p2
[11:30:45.456] [WARN ] [llm-provider.openai] [GAME:game-abc] API rate limit approaching (87% of 500 RPM)
[11:30:46.001] [ERROR] [agent-coordinator] [GAME:game-abc] Agent p3 failed to generate response
    data: { "error": "context_length_exceeded", "model": "gpt-3.5-turbo" }
[11:30:50.000] [DEBUG] [game-engine.fsm] [GAME:game-abc] State transition: DAY_VOTING → RESOLUTION
```

**Configuration**:
```typescript
export interface StdoutTransportConfig {
  /** Enable color output (default: true for TTY, false for pipes) */
  color: boolean;
  /** Show timestamp with or without date (default: time-only) */
  timestampFormat: 'time' | 'datetime' | 'iso';
  /** Minimum level to output to stdout */
  minLevel: LogLevel;
  /** Indent data objects for readability */
  prettyData: boolean;
  /** Omit the component name (compact mode) */
  compact: boolean;
}
```

**Default config**:
```typescript
const DEFAULT_STDOUT: StdoutTransportConfig = {
  color: process.stdout.isTTY ?? true,
  timestampFormat: 'time',
  minLevel: 'INFO',
  prettyData: true,
  compact: false,
};
```

### 3.2 File Transport (JSON, Rotating)

**Format**: One JSON log entry per line (JSONL format).

**File naming**: `logs/mafia-YYYY-MM-DD.N.log` where `N` is the rotation index.

**Rotation policy**:
- **Max file size**: 10 MB per file
- **Max files**: 5 retained (50 MB total)
- **Rotation**: When current file exceeds 10 MB, it's renamed to `.1`, `.2`, etc., and highest `.5` is deleted
- **Compression** (optional): Rotated files can be gzipped (`.gz` suffix)

**File structure**:
```
logs/
├── mafia-2025-06-09.0.jsonl       ← Current file
├── mafia-2025-06-09.1.jsonl       ← Rotated (oldest → newest)
├── mafia-2025-06-08.4.jsonl       ← Previous day, last rotation
└── mafia-2025-06-08.3.jsonl
```

**Example file content** (`logs/mafia-2025-06-09.0.jsonl`):
```jsonl
{"timestamp":"2025-06-09T11:30:00.000Z","level":"INFO","component":"server","message":"Server starting on port 3000","pid":28461,"hostname":"helios-server","category":"system"}
{"timestamp":"2025-06-09T11:30:01.500Z","level":"INFO","component":"game-engine","message":"Game created: game-abc123","gameId":"game-abc123","pid":28461,"hostname":"helios-server","category":"system"}
{"timestamp":"2025-06-09T11:30:45.123Z","level":"INFO","component":"game-engine.voting","message":"Vote cast: p1 voted for p2","gameId":"game-abc123","playerId":"p1","turnNumber":14,"correlationId":"corr-x7k2m9","eventType":"VOTE_CAST","pid":28461,"hostname":"helios-server","category":"game"}
```

**Configuration**:
```typescript
export interface FileTransportConfig {
  /** Enable file logging */
  enabled: boolean;
  /** Directory for log files */
  outputDir: string;              // Default: './logs'
  /** Maximum file size in bytes before rotation */
  maxFileSize: number;            // Default: 10 * 1024 * 1024 (10 MB)
  /** Maximum rotated files to retain */
  maxFiles: number;               // Default: 5
  /** Compress rotated files with gzip */
  compress: boolean;              // Default: false
  /** Minimum level to write to file */
  minLevel: LogLevel;
  /** Categories to include (system and/or game) */
  categories: Array<'system' | 'game'>;
}
```

**Default config**:
```typescript
const DEFAULT_FILE: FileTransportConfig = {
  enabled: true,
  outputDir: './logs',
  maxFileSize: 10 * 1024 * 1024,
  maxFiles: 5,
  compress: false,
  minLevel: 'INFO',
  categories: ['system', 'game'],
};
```

### 3.3 Database Transport (Queryable via SQLite)

Logs are written to the same SQLite database as game data, in a dedicated `system_logs` table.

**Schema migration** (addition to `apps/server/src/db/schema.sql`):

```sql
-- System and game event log (queryable, structured)
CREATE TABLE IF NOT EXISTS system_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,          -- ISO 8601 with ms
  level TEXT NOT NULL,              -- DEBUG, INFO, WARN, ERROR, FATAL
  component TEXT NOT NULL,          -- Dot-notation component name
  message TEXT NOT NULL,
  game_id TEXT,                     -- FK reference to games(id), nullable (system logs have no game)
  player_id TEXT,                   -- FK reference to players(id), nullable
  turn_number INTEGER,
  day_number INTEGER,
  phase TEXT,
  correlation_id TEXT,              -- For linking related entries
  event_type TEXT,                  -- GameEvent.type if sourced from EventBus
  category TEXT NOT NULL,           -- 'system' or 'game'
  data TEXT,                        -- JSON blob for arbitrary structured data
  source TEXT,                      -- File:line (DEBUG only)
  pid INTEGER NOT NULL,
  hostname TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
CREATE INDEX IF NOT EXISTS idx_system_logs_component ON system_logs(component);
CREATE INDEX IF NOT EXISTS idx_system_logs_game ON system_logs(game_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_correlation ON system_logs(correlation_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_category ON system_logs(category);
CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp ON system_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_system_logs_event_type ON system_logs(event_type);
```

**Query examples**:

```sql
-- Get all ERROR/FATAL logs for a specific game
SELECT timestamp, component, message, data
FROM system_logs
WHERE game_id = 'game-abc'
  AND level IN ('ERROR', 'FATAL')
ORDER BY timestamp DESC
LIMIT 50;

-- Trace all logs for a correlation ID (distributed trace)
SELECT timestamp, level, component, message
FROM system_logs
WHERE correlation_id = 'corr-x7k2m9'
ORDER BY timestamp ASC;

-- Error rate by component (last 1 hour)
SELECT component, level, COUNT(*) as count
FROM system_logs
WHERE timestamp > datetime('now', '-1 hour')
  AND level IN ('ERROR', 'FATAL')
GROUP BY component
ORDER BY count DESC;

-- Recent game events from logs (alternative to events table, includes system context)
SELECT timestamp, component, message, event_type, data
FROM system_logs
WHERE game_id = 'game-abc'
  AND category = 'game'
ORDER BY timestamp DESC
LIMIT 100;

-- Show DEBUG logs for specific component only
SELECT timestamp, component, message, data
FROM system_logs
WHERE component LIKE 'agent-coordinator.%'
  AND level = 'DEBUG'
ORDER BY timestamp DESC;
```

**Database transport config**:
```typescript
export interface DatabaseTransportConfig {
  /** Enable database logging */
  enabled: boolean;
  /** Minimum level to persist */
  minLevel: LogLevel;
  /** Maximum age before log entries are pruned (days). 0 = never prune. */
  retentionDays: number;          // Default: 30
  /** Batch size for SQLite inserts */
  batchSize: number;              // Default: 50
  /** Categories to include */
  categories: Array<'system' | 'game'>;
}
```

---

## 4. Correlation IDs

Every request or logical operation receives a unique **correlation ID** that propagates through all related log entries, enabling end-to-end tracing.

### 4.1 Generation

```typescript
import { v4 as uuidv4 } from 'uuid';

// Correlation IDs are short (8 chars from UUID) for readability in logs,
// but unique enough for practical tracing.
export function createCorrelationId(): string {
  return 'corr-' + uuidv4().slice(0, 8);
}
```

### 4.2 Propagation

Correlation IDs travel with the flow of execution:

```
HTTP Request → correlationId → GameEngine → EventBus → Logger
                                              ↓
                                    AgentCoordinator → LLM Provider → Logger
```

**Propagation mechanisms**:

1. **HTTP requests**: Extracted from request header `X-Correlation-ID` (if provided by client) or generated on receipt. Stored on `res.locals.correlationId`. Included in Express request log.

2. **Game operations**: When `GameEngine` processes a game action (create, start, vote, etc.), the correlation ID from the triggering HTTP request is passed through to all game events logged during that operation.

3. **EventBus integration** (see §6): When an event is published, the logger subscriber reads the correlation ID from the current async context (via `AsyncLocalStorage`).

4. **LLM calls**: The `AgentCoordinator` sets a new child correlation ID for each agent turn, linking it to the parent game operation.

### 4.3 AsyncLocalStorage Context

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

export const logContext = new AsyncLocalStorage<LogContext>();

export interface LogContext {
  correlationId: string;
  gameId?: string;
  playerId?: string;
  turnNumber?: number;
  dayNumber?: number;
  phase?: GamePhase;
}

// Usage in middleware:
function setLogContext(ctx: Partial<LogContext>): void {
  const store = logContext.getStore();
  if (store) {
    Object.assign(store, ctx);
  }
}
```

**Express middleware**:
```typescript
app.use((req, res, next) => {
  const correlationId = (req.headers['x-correlation-id'] as string) || createCorrelationId();
  res.setHeader('X-Correlation-ID', correlationId);

  const ctx: LogContext = { correlationId };
  logContext.run(ctx, () => {
    res.locals.correlationId = correlationId;
    next();
  });
});
```

Logger methods automatically read from `logContext` to populate `correlationId`, `gameId`, `playerId`, etc. on each log entry.

---

## 5. Game Event Log vs System Log Separation

### 5.1 Two Log Streams

| Category | Purpose | Content | Storage |
|----------|---------|---------|---------|
| **`system`** | Server operations, health, errors | Server startup/shutdown, HTTP requests, LLM API calls, database operations, unhandled exceptions | All transports (stdout + file + db) |
| **`game`** | Replayable game event trail | Every `GameEvent` from EventBus: votes, kills, phase changes, agent think/say | File + database (not stdout by default at high volume) |

### 5.2 Separation at Transport Level

Each transport can independently filter by category:

```typescript
// Stdout: system logs always, game logs only at WARN+
stdoutTransport.categories = ['system'];
stdoutTransport.gameMinLevel = 'WARN';

// File: both streams, full fidelity
fileTransport.categories = ['system', 'game'];

// Database: game events go to system_logs table with category='game'
// AND to the existing events table (via EventBus→GameRepository).
// This avoids double-storing; game events in system_logs are a query optimization.
```

### 5.3 Game Event in System Log

When a `GameEvent` is logged (via EventBus integration), the system log entry:
- Sets `category: 'game'`
- Sets `eventType` to the GameEvent's `type`
- Sets `gameId`, `playerId` (from `actorId`), `turnNumber`, `dayNumber`, `phase`
- Sets `data` to the full event payload
- Sets `correlationId` from the current context

This allows querying game events through the unified logging table while maintaining the existing `events` table for event sourcing replay.

---

## 6. EventBus Integration

### 6.1 Subscribe-All Pattern

The `LoggerService` subscribes to the EventBus using `subscribeAll()` (wildcard handler), receiving every `GameEvent` published anywhere in the system:

```typescript
class LoggerService {
  constructor(private eventBus: EventBus, private config: LoggerConfig) {
    // Subscribe to all game events automatically
    this.eventBus.subscribeAll(
      (event: GameEvent) => this.onGameEvent(event),
      {
        filter: (event) => {
          // Optionally filter: don't log every THINK_CHUNK at high throughput
          if (event.type.startsWith('AGENT_THINK_') && this.config.gameLogLevel === 'INFO') {
            return false; // Skip token-level think events unless DEBUG
          }
          return true;
        }
      }
    );
  }

  private onGameEvent(event: GameEvent): void {
    // This automatically creates a log entry for every game event
    this.log({
      level: this.eventLevelMap[event.type] || 'INFO',
      component: this.eventComponentMap[event.type] || 'game-engine',
      message: this.formatEventMessage(event),
      category: 'game',
      gameId: event.gameId,
      playerId: event.actorId,
      turnNumber: event.metadata.turnNumber,
      dayNumber: event.metadata.dayNumber,
      phase: event.metadata.phase,
      eventType: event.type,
      data: event.data as Record<string, unknown>,
    });
  }
}
```

### 6.2 Event-Level Mapping

Game events map to log levels based on their significance:

```typescript
const eventLevelMap: Record<string, LogLevel> = {
  GAME_CREATED: 'INFO',
  GAME_STARTED: 'INFO',
  GAME_ENDED: 'INFO',
  PHASE_CHANGED: 'INFO',
  VOTE_CAST: 'INFO',
  PLAYER_ELIMINATED: 'INFO',
  NIGHT_ACTION_SUBMITTED: 'INFO',
  WINNER_DETERMINED: 'INFO',
  ROLES_ASSIGNED: 'INFO',

  // WARN-level events (unusual but valid)
  VOTE_RETRACTED: 'WARN',
  TIMEOUT_EXTENDED: 'WARN',

  // ERROR-level events
  AGENT_ERROR: 'ERROR',
  MAFIA_KILL_FAILED: 'WARN',
  DOCTOR_PROTECTION_FAILED: 'WARN',

  // DEBUG-level events (high volume)
  AGENT_THINK_STARTED: 'DEBUG',
  AGENT_THINK_COMPLETED: 'DEBUG',
  AGENT_SAYS_BROADCASTED: 'DEBUG',
  MAFIA_TEAM_NOTIFIED: 'DEBUG',
};
```

### 6.3 Event-to-Component Mapping

```typescript
const eventComponentMap: Record<string, string> = {
  GAME_CREATED: 'game-engine',
  PHASE_CHANGED: 'game-engine.fsm',
  VOTE_CAST: 'game-engine.voting',
  NIGHT_ACTION_SUBMITTED: 'game-engine.night',
  AGENT_THINK_STARTED: 'agent-coordinator',
  AGENT_SAYS_BROADCASTED: 'agent-coordinator',
  AGENT_ERROR: 'agent-coordinator',
  // ... etc
};
```

### 6.4 No Dual-Write Required

Callers **never need to manually log game events**. Publishing to the EventBus is sufficient. The `LoggerService` automatically captures every event. This is the single source of truth pattern:

```
GameEngine.publish(event)  →  EventBus.publish(event)
                                    ├── WebSocket broadcast
                                    ├── StatsCollector.record(event)
                                    ├── GameRepository.addEvent(event)  // events table
                                    └── LoggerService.onGameEvent(event) // system_logs table
```

---

## 7. Performance: Async Writes, Batching, DEBUG Sampling

### 7.1 Async Write Architecture

All transport writes are non-blocking. The Logger Service uses an internal message queue processed by a dedicated async worker:

```typescript
class LoggerService {
  private queue: LogEntry[] = [];
  private flushPromise: Promise<void> | null = null;
  private flushScheduled = false;

  log(entry: Omit<LogEntry, 'timestamp' | 'pid' | 'hostname'>): void {
    const fullEntry: LogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      pid: process.pid,
      hostname: os.hostname(),
      // Populate from AsyncLocalStorage context
      correlationId: entry.correlationId ?? logContext.getStore()?.correlationId,
      gameId: entry.gameId ?? logContext.getStore()?.gameId,
      playerId: entry.playerId ?? logContext.getStore()?.playerId,
    };

    // Queue (non-blocking push)
    this.queue.push(fullEntry);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;

    // Flush on next microtask tick — batches writes that occur
    // within the same synchronous execution frame
    this.flushPromise = Promise.resolve().then(() => this.flush());
  }

  private async flush(): Promise<void> {
    this.flushScheduled = false;
    const batch = this.queue.splice(0);
    if (batch.length === 0) return;

    const promises: Promise<void>[] = [];
    for (const transport of this.transports) {
      promises.push(transport.write(batch));
    }
    await Promise.allSettled(promises);
  }

  /** Force flush all pending entries (used on shutdown) */
  async shutdown(): Promise<void> {
    // Flush any remaining entries
    if (this.queue.length > 0) {
      await this.flush();
    }
    // Wait for any in-flight flush
    if (this.flushPromise) {
      await this.flushPromise;
    }
  }
}
```

### 7.2 Batching Strategy

| Transport | Batch Strategy | Rationale |
|-----------|---------------|-----------|
| **Stdout** | Flush per-entry (synchronous-like) | Console output must maintain temporal ordering for humans |
| **File** | Buffer up to 64 entries or 100ms, whichever first | Reduces fsync calls; order maintained within buffer |
| **Database** | Batch INSERT of up to 50 entries per transaction | SQLite performance (single writer). Commit every 250ms or batch-full. |

**File transport batch config**:
```typescript
export const FILE_BATCH_CONFIG = {
  maxBatchSize: 64,           // Entries per write
  maxBatchDelayMs: 100,       // Flush after this many ms even if batch not full
  writeMode: 'append',        // Use O_APPEND for performance
};
```

**Database transport batch config**:
```typescript
export const DB_BATCH_CONFIG = {
  maxBatchSize: 50,           // Rows per INSERT
  maxBatchDelayMs: 250,       // Flush after this many ms
  commitTimeoutMs: 5000,      // Max time a transaction can stay open
};
```

### 7.3 Guaranteed Flush on Shutdown

```typescript
// In server main (apps/server/src/index.ts):
const logger = new LoggerService(eventBus, logConfig);

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await logger.shutdown();   // Flush all pending logs before exit
  process.exit(0);
});
```

**"Fire and forget" pattern**: The `log()` method is always synchronous from the caller's perspective. Log entries are queued and flushed asynchronously. If the process crashes before a flush, at most ~100ms (file) or ~250ms (db) of the most recent entries may be lost — an acceptable trade-off for game logging.

### 7.4 DEBUG Sampling

At high game volumes (many agents streaming think/say tokens), DEBUG-level events can overwhelm storage. The system supports **sampling** to reduce DEBUG log volume:

```typescript
export interface DebugSamplingConfig {
  /** Enable sampling for DEBUG-level events */
  enabled: boolean;
  /** Sampling rate: 0.0 = drop all, 1.0 = keep all, 0.1 = keep 10% */
  rate: number;
  /** Components to apply sampling to (empty = all) */
  components?: string[];
  /** Event types to always log regardless of sampling */
  alwaysLog?: string[];          // e.g., ['AGENT_ERROR']
}
```

**Sampling algorithm**:
```typescript
function shouldSampleDebug(
  entry: Omit<LogEntry, 'timestamp'>,
  config: DebugSamplingConfig
): boolean {
  if (entry.level !== 'DEBUG') return true; // Only sample DEBUG

  // Always log certain event types
  if (config.alwaysLog?.includes(entry.eventType ?? '')) return true;

  // Always log ERROR/FATAL regardless of sampling
  if (entry.level === 'ERROR' || entry.level === 'FATAL') return true;

  // Component-specific sampling (e.g., sample agent-coordinator.llm at 10%)
  if (config.components && config.components.length > 0) {
    const matches = config.components.some(c =>
      entry.component === c || entry.component.startsWith(c + '.')
    );
    if (!matches) return true; // Not in sampled components, log normally
  }

  // Probabilistic sampling
  return Math.random() < config.rate;
}
```

**Recommended sampling config** for production:
```typescript
const debugSampling: DebugSamplingConfig = {
  enabled: true,
  rate: 0.05,  // Log 5% of DEBUG entries
  components: ['agent-coordinator.llm', 'game-engine.voting'],
  alwaysLog: ['AGENT_ERROR', 'MAFIA_KILL_FAILED'],
};
```

---

## 8. LoggerService API

### 8.1 Main Interface

```typescript
export interface ILogger {
  debug(component: string, message: string, data?: Record<string, unknown>): void;
  info(component: string, message: string, data?: Record<string, unknown>): void;
  warn(component: string, message: string, data?: Record<string, unknown>): void;
  error(component: string, message: string, error?: Error, data?: Record<string, unknown>): void;
  fatal(component: string, message: string, error?: Error, data?: Record<string, unknown>): void;
  child(childComponent: string): ILogger;
  shutdown(): Promise<void>;
}
```

### 8.2 Usage Examples

```typescript
// Direct logging from any service:
class GameEngine {
  private logger: ILogger;

  constructor(/* ... */, logger: ILogger) {
    this.logger = logger.child('game-engine');
  }

  processVote(vote: Vote): void {
    this.logger.info('voting', 'Vote cast', {
      voterId: vote.voterId,
      targetId: vote.targetId,
    });

    try {
      // ... logic
    } catch (err) {
      this.logger.error('voting', 'Vote processing failed', err as Error, {
        voteId: vote.voterId,
      });
    }
  }
}

// Contextual logging via AsyncLocalStorage:
// The HTTP middleware sets gameId/playerId/turnNumber in logContext,
// so log entries automatically include them without passing them explicitly.
```

### 8.3 Child Loggers

The `child()` method creates a sub-logger with a prefixed component name:

```typescript
const gameLogger = logger.child('game-engine');
const votingLogger = gameLogger.child('voting');
// votingLogger component = "game-engine.voting"
```

This ensures all log entries from a sub-system share a consistent component prefix, making filtering straightforward.

### 8.4 Configuration

```typescript
export interface LoggerConfig {
  // Global level filtering
  filter: LogFilterConfig;

  // Transports
  stdout: StdoutTransportConfig;
  file: FileTransportConfig;
  database: DatabaseTransportConfig;

  // Performance
  debugSampling: DebugSamplingConfig;

  // Game event logging
  gameLogLevel: LogLevel;           // Minimum level for EventBus→log entries
  excludeEventTypes: string[];      // Event types to never log (e.g., keep-every-alive PING)
}
```

**Environment variable overrides**:
```bash
LOG_LEVEL=INFO                          # Global minimum level
LOG_STDOUT_MIN_LEVEL=WARN              # Stdout minimum
LOG_FILE_ENABLED=true                  # Enable file transport
LOG_FILE_DIR=./logs                    # Log file directory
LOG_DB_ENABLED=true                    # Enable database transport
LOG_DB_RETENTION_DAYS=30              # Database log retention
LOG_DEBUG_SAMPLE_RATE=0.05            # DEBUG sampling rate
```

### 8.5 Initialization

```typescript
// In apps/server/src/index.ts main():
const logConfig = loadLogConfig(); // From env + defaults
const logger = new LoggerService(eventBus, logConfig);

// Attach to ServerContext
const context: ServerContext = {
  logger,           // ← NEW
  gameEngine,
  agentCoordinator,
  eventBus,
  statsCollector,
  gameRepository,
};

// Pass logger to services
const gameEngine = new GameEngine(
  gameRepository, agentCoordinator, eventBus, statsCollector,
  logger.child('game-engine')    // ← NEW
);
```

---

## 9. Migration Path: From console.log to LoggerService

### 9.1 Current State

The server (`apps/server/src/index.ts` and sub-services) currently uses `console.log` / `console.error` directly (approximately 30+ instances). The existing `4473f3b`-era game engine (`game-engine.js`, ~5236 lines) uses `console.log` extensively.

### 9.2 Migration Steps

**Phase 1: Introduce LoggerService (non-breaking)**
1. Create `apps/server/src/services/logger.ts` with `LoggerService` class
2. Add `logger` to `ServerContext`
3. Wire logger into `EventBus.subscribeAll()` for automatic game event capture
4. Replace `console.log` in `index.ts` with `logger.info/info/warn/error`
5. Add Express middleware for correlation ID + request logging

**Phase 2: Integrate into services**
1. Update `GameEngine` constructor to accept `ILogger`
2. Replace `console.log` in `game-engine.ts` with `this.logger.*`
3. Update `AgentCoordinator` to accept `ILogger`
4. Replace `console.log` in `agent-coordinator.ts` with `this.logger.*`
5. Update `StatsCollector` to accept `ILogger`
6. Update `WebSocket` handler to accept `ILogger`

**Phase 3: Game engine migration**
1. The monolithic `game-engine.js` (5236 lines) requires a shim:
   ```typescript
   // Temporary compatibility: forward console.log to logger
   const originalLog = console.log;
   console.log = (...args: unknown[]) => {
     logger.debug('game-engine.legacy', args.join(' '));
   };
   ```
2. Gradually refactor game-engine.js into TypeScript modules, each with proper `logger.child()` calls.

### 9.3 Backward Compatibility

During migration, both `console.log` and `LoggerService` coexist. The `LoggerService` intercepts `GameEvent`s from the EventBus regardless of whether individual services have been migrated.

---

## 10. Testing & Observability

### 10.1 Test Utilities

```typescript
// In-memory logger for tests:
export class MemoryLogger implements ILogger {
  entries: LogEntry[] = [];

  debug(component: string, message: string, data?: Record<string, unknown>): void {
    this.entries.push({ /* ... */ });
  }
  // ... etc

  getByLevel(level: LogLevel): LogEntry[] { /* ... */ }
  getByComponent(component: string): LogEntry[] { /* ... */ }
  getByGame(gameId: string): LogEntry[] { /* ... */ }
  clear(): void { this.entries = []; }
}
```

### 10.2 Health Endpoint Extension

Extend `/health` to include logger stats:

```json
{
  "status": "healthy",
  "logger": {
    "entriesWritten": 15234,
    "queueDepth": 0,
    "lastFlushMs": 12,
    "transports": {
      "stdout": "healthy",
      "file": "healthy (logs/mafia-2025-06-09.0.jsonl, 2.4MB)",
      "database": "healthy (system_logs: 15234 rows)"
    },
    "debugSampleRate": 0.05,
    "droppedCount": 3
  }
}
```

### 10.3 Internal Metrics

The LoggerService emits its own metrics through a lightweight internal counter:

```typescript
interface LoggerMetrics {
  entriesWritten: number;
  entriesDropped: number;       // Filtered by level
  entriesSampled: number;       // Skipped by DEBUG sampling
  flushCount: number;
  flushDurationMs: number[];    // Last 100 flush durations (circular buffer)
  queueHighWaterMark: number;   // Max queue depth observed
  transportErrors: Record<string, number>; // Per-transport error count
}
```

---

## 11. File Structure

```
apps/server/src/services/
├── logger.ts                    # LoggerService, ILogger, LogEntry, config types
├── logger.test.ts               # Unit tests
├── transports/
│   ├── stdout-transport.ts      # Colored console output
│   ├── file-transport.ts        # JSONL rotating file
│   └── database-transport.ts    # SQLite system_logs table writer
├── event-bus.ts                 # Existing — no changes needed
└── ... (existing services)

apps/server/src/db/
├── schema.sql                   # Add system_logs table (new migration)
└── migrations/
    └── 002_add_system_logs.sql  # Migration file

packages/shared/src/
└── types/
    └── index.ts                 # LogLevel already exists; add LogEntry if needed
```

---

## 12. Summary

| Feature | Implementation |
|---------|---------------|
| **Log levels** | DEBUG/INFO/WARN/ERROR/FATAL, with `LOG_LEVEL_VALUES` numeric mapping |
| **Per-component filtering** | Dot-notation component names with inheritance; `LogFilterConfig.componentLevels` |
| **Structured JSON** | `LogEntry` interface with required + optional contextual fields |
| **Stdout transport** | ANSI-colored, human-readable, configurable timestamp & compact modes |
| **File transport** | JSONL format, 10 MB rotation, 5 files retained, optional gzip |
| **Database transport** | `system_logs` table in SQLite, indexed, with 30-day retention |
| **Correlation IDs** | 8-char UUID prefix, propagated via `AsyncLocalStorage` + HTTP header |
| **Game/System separation** | `category: 'game' | 'system'` field; per-transport category filtering |
| **EventBus integration** | `subscribeAll()` on EventBus; every `GameEvent` auto-logged — no dual-write |
| **Async writes** | Internal message queue, microtask-batched flush, non-blocking for callers |
| **Batching** | File: 64 entries/100ms; DB: 50 entries/250ms per transaction |
| **DEBUG sampling** | Probabilistic sampling with rate config, per-component targeting, always-log list |
| **Migration path** | 3-phase: introduce LoggerService → integrate services → refactor legacy JS |

---

## Appendix A: LogEntry JSON Schema (for validation)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["timestamp", "level", "component", "message", "pid", "hostname", "category"],
  "properties": {
    "timestamp": { "type": "string", "format": "date-time" },
    "level": { "enum": ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"] },
    "component": { "type": "string" },
    "message": { "type": "string", "minLength": 1 },
    "gameId": { "type": "string" },
    "playerId": { "type": "string" },
    "turnNumber": { "type": "integer", "minimum": 0 },
    "dayNumber": { "type": "integer", "minimum": 0 },
    "phase": { "type": "string" },
    "correlationId": { "type": "string", "pattern": "^corr-[a-f0-9]{8}$" },
    "eventType": { "type": "string" },
    "data": { "type": "object" },
    "source": { "type": "string" },
    "pid": { "type": "integer" },
    "hostname": { "type": "string" },
    "category": { "enum": ["system", "game"] }
  }
}
```

## Appendix B: Quick-Start Config

Minimal production config for `mafia-config.yaml`:

```yaml
logging:
  globalLevel: INFO
  componentLevels:
    agent-coordinator.llm: DEBUG
    server.http: WARN
  stdout:
    minLevel: INFO
    color: true
  file:
    enabled: true
    outputDir: ./logs
    maxFileSize: 10485760
    maxFiles: 5
    minLevel: INFO
  database:
    enabled: true
    minLevel: INFO
    retentionDays: 30
    batchSize: 50
  debugSampling:
    enabled: true
    rate: 0.05
  gameLogLevel: INFO
  excludeEventTypes: []
```
