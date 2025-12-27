# Database Schema

## Overview
The system uses SQLite with a simple schema optimized for event sourcing and game replay. The database stores games metadata, event streams, and optional snapshots for fast replay.

## Schema Definition

### Core Tables

#### games Table
Stores game metadata and configuration.

```sql
CREATE TABLE games (
  -- Primary identifier
  id TEXT PRIMARY KEY NOT NULL,
  
  -- Game configuration
  seed INTEGER NOT NULL,
  player_count INTEGER NOT NULL,
  mafia_count INTEGER NOT NULL,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'CREATED' 
    CHECK (status IN ('CREATED', 'RUNNING', 'PAUSED', 'FINISHED', 'CANCELLED')),
  phase TEXT CHECK (phase IN ('SETUP', 'NIGHT_ACTIONS', 'MORNING_REVEAL', 'DAY_DISCUSSION', 'DAY_VOTING', 'RESOLUTION', 'END')),
  day_number INTEGER DEFAULT 0,
  round_number INTEGER DEFAULT 0,
  winner TEXT CHECK (winner IN ('town', 'mafia')),
  
  -- Timing
  created_at INTEGER NOT NULL,  -- Unix timestamp (ms)
  started_at INTEGER,           -- Unix timestamp (ms)
  finished_at INTEGER,          -- Unix timestamp (ms)
  
  -- Metadata
  duration_ms INTEGER,          -- Total game duration
  
  -- JSON data
  config_json TEXT NOT NULL,    -- Full config object
  initial_roles TEXT NOT NULL,  -- Initial role assignments
  
  -- Indexes
  created_at_idx INTEGER
);

CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_games_created_at ON games(created_at);
CREATE INDEX idx_games_phase ON games(phase);
CREATE INDEX idx_games_winner ON games(winner);
```

**Columns:**
- `id`: Unique game identifier (e.g., "game-abc123")
- `seed`: Random seed for deterministic replay
- `player_count`: Total number of players
- `mafia_count`: Number of mafia players
- `status`: Current game status
- `phase`: Current game phase
- `day_number`: Current day (increments after each night)
- `round_number`: Total round count (each phase is a round)
- `winner`: Winner if game finished
- `created_at`: When game was created
- `started_at`: When game started (after /start call)
- `finished_at`: When game finished
- `duration_ms`: Total duration in milliseconds
- `config_json`: JSON string of full game config
- `initial_roles`: JSON array of initial role assignments

**Example data:**
```sql
INSERT INTO games (
  id, seed, player_count, mafia_count, status, phase, day_number, round_number,
  created_at, started_at, config_json, initial_roles
)
VALUES (
  'game-123',
  12345,
  10,
  3,
  'RUNNING',
  'DAY_VOTING',
  2,
  5,
  1703774400000,
  1703774401000,
  '{"players":10,"mafia":3,"mode":"scripted"}',
  '[{"id":"p1","name":"Alice","role":"villager"},{"id":"p2","name":"Bob","role":"mafia"}]'
);
```

---

#### events Table
Append-only event log for event sourcing.

```sql
CREATE TABLE events (
  -- Primary key (auto-increment)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Game reference
  game_id TEXT NOT NULL,
  
  -- Event ordering (critical for replay)
  sequence INTEGER NOT NULL,
  
  -- Event metadata
  event_type TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,  -- Unix timestamp (ms)
  
  -- Privacy flag
  private BOOLEAN DEFAULT FALSE,
  
  -- Event payload (JSON)
  payload TEXT NOT NULL,
  
  -- Indexes
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_events_game_sequence ON events(game_id, sequence);
CREATE INDEX idx_events_game_type ON events(game_id, event_type);
CREATE INDEX idx_events_timestamp ON events(game_id, timestamp_ms);
```

**Constraints:**
- `(game_id, sequence)` must be unique (prevent duplicate events)
- Foreign key cascade: deleting game deletes all its events
- Events are append-only (never updated or deleted)

**Example data:**
```sql
INSERT INTO events (game_id, sequence, event_type, timestamp_ms, private, payload)
VALUES (
  'game-123',
  0,
  'GAME_CREATED',
  1703774400000,
  FALSE,
  '{"gameId":"game-123","seed":12345,"config":{"players":10,"mafia":3}}'
);

INSERT INTO events (game_id, sequence, event_type, timestamp_ms, private, payload)
VALUES (
  'game-123',
  1,
  'PHASE_CHANGED',
  1703774401000,
  FALSE,
  '{"from":"SETUP","to":"NIGHT_ACTIONS","dayNumber":0,"roundNumber":0}'
);
```

---

#### snapshots Table (Optional)
Game state snapshots for fast replay.

```sql
CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Game reference
  game_id TEXT NOT NULL,
  
  -- Snapshot position
  sequence INTEGER NOT NULL,  -- Sequence number up to which this snapshot represents
  
  -- Snapshot data
  game_state TEXT NOT NULL,  -- JSON string of full game state
  created_at INTEGER NOT NULL, -- Unix timestamp (ms)
  
  -- Indexes
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_snapshots_game_sequence ON snapshots(game_id, sequence);
```

**When to snapshot:**
- At the end of each phase (NIGHT_ACTIONS, MORNING_REVEAL, etc.)
- Every 10 rounds as a safety backup
- On game pause (for debugging)

**Example usage:**
```typescript
// Replay from snapshot instead of start
const snapshot = loadSnapshot(gameId, sequence = 50);
const eventsAfterSnapshot = getEvents(gameId, since = 51);
const finalState = replayFromSnapshot(snapshot, eventsAfterSnapshot);
```

---

## Query Patterns

### Get Single Game
```sql
SELECT * FROM games WHERE id = 'game-123';
```

### Get All Events for Game
```sql
SELECT * FROM events 
WHERE game_id = 'game-123' 
ORDER BY sequence ASC;
```

### Get Events Since Sequence (for polling/streaming)
```sql
SELECT * FROM events 
WHERE game_id = 'game-123' 
  AND sequence > 15
ORDER BY sequence ASC
LIMIT 100;  -- Prevent loading too many at once
```

### Get Game Status
```sql
SELECT 
  id, status, phase, day_number, round_number, 
  winner, player_count, alive_count
FROM games WHERE id = 'game-123';
```

### List Recent Games
```sql
SELECT 
  id, status, phase, day_number, winner,
  created_at, started_at, finished_at
FROM games 
WHERE status != 'CANCELLED'
ORDER BY created_at DESC
LIMIT 50;
```

### Export Events (for export endpoint)
```sql
SELECT 
  event_type, sequence, timestamp_ms, private, payload
FROM events 
WHERE game_id = 'game-123'
ORDER BY sequence ASC;
```

---

## Storage Abstraction Layer

### Interface
```typescript
interface GameStorage {
  // Games
  createGame(gameConfig: GameConfig): Promise<Game>;
  getGame(gameId: string): Promise<Game | null>;
  updateGame(gameId: string, updates: Partial<Game>): Promise<void>;
  listGames(filters?: GameFilters): Promise<Game[]>;
  
  // Events
  appendEvent(gameId: string, event: Event): Promise<void>;
  getEvents(gameId: string, options?: EventQueryOptions): Promise<Event[]>;
  appendEvents(gameId: string, events: Event[]): Promise<void>;
  
  // Snapshots (optional)
  createSnapshot(gameId: string, sequence: number, state: GameState): Promise<void>;
  getSnapshot(gameId: string, sequence: number): Promise<Snapshot | null>;
  getLatestSnapshot(gameId: string): Promise<Snapshot | null>;
}
```

### SQLite Implementation
```typescript
class SQLiteGameStorage implements GameStorage {
  private db: Database;
  
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initializeTables();
  }
  
  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (...);
      CREATE INDEX IF NOT EXISTS ...;
      CREATE TABLE IF NOT EXISTS events (...);
      CREATE INDEX IF NOT EXISTS ...;
    `);
  }
  
  async createGame(config: GameConfig): Promise<Game> {
    const game = createGameFromConfig(config);
    const stmt = this.db.prepare(`
      INSERT INTO games (id, seed, player_count, mafia_count, status, created_at, config_json, initial_roles)
      VALUES (@id, @seed, @playerCount, @mafiaCount, 'CREATED', @createdAt, @configJson, @initialRoles)
    `);
    stmt.run({
      id: game.id,
      seed: game.seed,
      playerCount: game.playerCount,
      mafiaCount: game.mafiaCount,
      createdAt: Date.now(),
      configJson: JSON.stringify(game.config),
      initialRoles: JSON.stringify(game.initialRoles)
    });
    return game;
  }
  
  async appendEvent(gameId: string, event: Event): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO events (game_id, sequence, event_type, timestamp_ms, private, payload)
      VALUES (@gameId, @sequence, @eventType, @timestamp, @private, @payload)
    `);
    stmt.run({
      gameId,
      sequence: event.sequence,
      eventType: event.eventType,
      timestamp: event.timestamp,
      private: event.private || false,
      payload: JSON.stringify(event.payload)
    });
  }
  
  async getEvents(gameId: string, options?: EventQueryOptions): Promise<Event[]> {
    let query = `
      SELECT sequence, event_type, timestamp_ms, private, payload
      FROM events 
      WHERE game_id = @gameId
    `;
    
    if (options?.since !== undefined) {
      query += ` AND sequence > @since`;
    }
    
    query += ` ORDER BY sequence ASC`;
    
    if (options?.limit) {
      query += ` LIMIT @limit`;
    }
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all({ gameId, since: options?.since, limit: options?.limit });
    
    return rows.map(row => ({
      eventType: row.event_type,
      sequence: row.sequence,
      timestamp: row.timestamp_ms,
      private: row.private,
      payload: JSON.parse(row.payload)
    }));
  }
}
```

---

## Migration Strategy

### Version 1: Initial Schema
```sql
-- migration_001_initial.sql
CREATE TABLE games (...);
CREATE TABLE events (...);
CREATE INDEX ...;
```

### Version 2: Add Snapshots
```sql
-- migration_002_add_snapshots.sql
CREATE TABLE snapshots (...);
CREATE INDEX ...;
```

### Version 3: Add Duration Tracking
```sql
-- migration_003_add_duration.sql
ALTER TABLE games ADD COLUMN duration_ms INTEGER;
```

### Migration Runner
```typescript
class MigrationRunner {
  private db: Database;
  
  async migrate(): Promise<void> {
    const currentVersion = this.getSchemaVersion();
    const migrations = this.getMigrations(currentVersion);
    
    for (const migration of migrations) {
      console.log(`Running migration: ${migration.name}`);
      this.db.exec(migration.sql);
      this.updateSchemaVersion(migration.version);
    }
  }
}
```

---

## Performance Considerations

### Event Table
- **Index strategy**: Primary index on (game_id, sequence) for replay
- **Query pattern**: Always query by game_id, then order by sequence
- **Write pattern**: Append-only, no updates or deletes
- **Size estimate**: ~1KB per event, 1000 events per game = ~1MB per game

### Optimization Tips
```sql
-- Use page size optimization
PRAGMA page_size = 4096;

-- Enable WAL mode for concurrent reads
PRAGMA journal_mode = WAL;

-- Set cache size (10MB)
PRAGMA cache_size = -10000;

-- Use prepared statements for repeated queries

-- Batch inserts for better performance
BEGIN TRANSACTION;
-- multiple INSERT statements
COMMIT;
```

### Partitioning Strategy (Future)
For very high event volume (>1M events):
```sql
-- Partition events by game_id hash
create table events_0 ...;
create table events_1 ...;
create table events_2 ...;
create table events_3 ...;
```

---

## Backup and Recovery

### Automatic Backups
- Backup every 24 hours
- Keep 7 days of backups
- Store in `backups/` directory

```bash
#!/bin/bash
# backup.sh
DATE=$(date +%Y%m%d_%H%M%S)
cp mafia.db "backups/mafia_${DATE}.db"
```

### Recovery
```bash
# Restore from backup
cp backups/mafia_20231227_120000.db mafia.db
```

---

## Security Considerations

### Access Control
- Database files should have restricted permissions
- Web UI should not access database directly (use API)
- CLI can access database directly for local development

### Data Privacy
- Private events filtered at API layer
- No sensitive data in logs (player names only)
- Event logs can be purged by deleting game