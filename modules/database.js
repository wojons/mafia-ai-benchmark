// ============================================
// Game Database - SQLite Integration (with sql.js)
// Implements database schema from specs/database-schema.md
// Uses sql.js (pure JavaScript, no native bindings)
// ============================================

const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

let SQL = null;

// Initialize sql.js (load WASM)
async function initSql() {
  if (!SQL) {
    try {
      SQL = await initSqlJs();
      console.log("[DB] sql.js initialized");
    } catch (e) {
      console.error("[DB] Failed to initialize sql.js:", e.message);
      throw e;
    }
  }
  return SQL;
}

class GameDatabase {
  constructor(dbPath = "./data/mafia.db") {
    this.dbPath = dbPath;
    this.db = null;
    this.SQL = null;

    // Ensure data directory exists
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  async connect() {
    if (this.db) return;

    try {
      // Initialize sql.js if not already done
      this.SQL = await initSql();

      // Try to load existing database or create new one
      if (fs.existsSync(this.dbPath)) {
        const fileBuffer = fs.readFileSync(this.dbPath);
        this.db = new this.SQL.Database(fileBuffer);
        console.log("[DB] Loaded existing database:", this.dbPath);
      } else {
        this.db = new this.SQL.Database();
        console.log("[DB] Created new database:", this.dbPath);
      }

      // Enable foreign keys
      this.db.run("PRAGMA foreign_keys = ON");

      // Performance optimizations
      this.db.run("PRAGMA journal_mode = WAL");
      this.db.run("PRAGMA synchronous = NORMAL");

      this.initializeTables();
      console.log("[DB] Connected to database:", this.dbPath);
    } catch (error) {
      console.error("[DB] Failed to connect to database:", error.message);
      throw error;
    }
  }

  initializeTables() {
    try {
      // Create games table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS games (
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
          winner TEXT CHECK (winner IN ('town', 'mafia', NULL)),

          -- Timing
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          finished_at INTEGER,
          duration_ms INTEGER,

          -- JSON data
          config_json TEXT NOT NULL,
          initial_roles TEXT NOT NULL,
          final_state TEXT
        )
      `);

      // Games indexes
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_games_status ON games(status)",
      );
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_games_created_at ON games(created_at)",
      );
      this.db.run("CREATE INDEX IF NOT EXISTS idx_games_phase ON games(phase)");
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_games_winner ON games(winner)",
      );

      // Create players table (per-game player tracking)
      this.db.run(`
        CREATE TABLE IF NOT EXISTS players (
          id INTEGER PRIMARY KEY AUTOINCREMENT,

          -- Game reference
          game_id TEXT NOT NULL,

          -- Player identification
          player_id TEXT NOT NULL,
          player_name TEXT NOT NULL,

          -- Role information
          assigned_role TEXT NOT NULL,
          is_alive INTEGER NOT NULL DEFAULT 1,

          -- AI model used
          model TEXT,
          provider TEXT,

          -- Timing
          joined_at INTEGER NOT NULL,

          -- Foreign key
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )
      `);

      // Players indexes
      this.db.run(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_players_game_id ON players(game_id, player_id)",
      );
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_players_role ON players(assigned_role)",
      );
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_players_model ON players(model)",
      );

      // Create events table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,

          -- Game reference
          game_id TEXT NOT NULL,

          -- Event ordering (critical for replay)
          sequence INTEGER NOT NULL,

          -- Event metadata
          event_type TEXT NOT NULL,
          timestamp_ms INTEGER NOT NULL,

          -- Privacy flag
          private BOOLEAN DEFAULT 0,

          -- Event payload
          payload TEXT NOT NULL,

          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )
      `);

      // Events indexes
      this.db.run(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_events_game_sequence ON events(game_id, sequence)",
      );
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_events_game_type ON events(game_id, event_type)",
      );
      this.db.run(
        "CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(game_id, timestamp_ms)",
      );

      // Create snapshots table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,

          -- Game reference
          game_id TEXT NOT NULL,

          -- Snapshot position
          sequence INTEGER NOT NULL,

          -- Snapshot data
          game_state TEXT NOT NULL,
          created_at INTEGER NOT NULL,

          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )
      `);

      // Snapshots indexes
      this.db.run(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_game_sequence ON snapshots(game_id, sequence)",
      );

      // Save to disk
      this.persist();

      console.log("[DB] Database tables initialized");
    } catch (error) {
      console.error("[DB] Failed to initialize tables:", error.message);
      throw error;
    }
  }

  // Save database to disk
  persist() {
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    } catch (error) {
      console.error("[DB] Failed to persist database:", error.message);
      throw error;
    }
  }

  // ==========================================
  // GAMES OPERATIONS
  // ==========================================

  createGame(gameData) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO games (
          id, seed, player_count, mafia_count, status,
          phase, day_number, round_number, created_at,
          config_json, initial_roles
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run([
        gameData.id,
        gameData.seed || Date.now(),
        gameData.playerCount,
        gameData.mafiaCount,
        gameData.status || "CREATED",
        gameData.phase || "SETUP",
        gameData.dayNumber || 0,
        gameData.roundNumber || 0,
        gameData.createdAt || Date.now(),
        JSON.stringify(gameData.config || {}),
        JSON.stringify(gameData.initialRoles || []),
      ]);

      stmt.free();
      this.persist();

      console.log(`[DB] Created game: ${gameData.id}`);
      return gameData.id;
    } catch (error) {
      console.error("[DB] Failed to create game:", error.message);
      throw error;
    }
  }

  getGame(gameId) {
    try {
      const stmt = this.db.prepare("SELECT * FROM games WHERE id = ?");
      stmt.bind([gameId]);

      // Get all rows
      const games = [];
      while (stmt.step()) {
        games.push(stmt.getAsObject());
      }
      stmt.free();

      if (!games || games.length === 0) {
        const notFoundError = new Error(`Game ${gameId} not found`);
        notFoundError.name = "GameNotFoundError";
        throw notFoundError;
      }

      const g = games[0];

      // Parse JSON fields
      return {
        ...g,
        config: JSON.parse(g.config_json),
        initialRoles: JSON.parse(g.initial_roles),
        finalState: g.final_state ? JSON.parse(g.final_state) : null,
      };
    } catch (error) {
      console.error("[DB] Failed to get game:", error.message);
      throw error;
    }
  }

  updateGame(gameId, updates) {
    try {
      const fields = [];
      const params = [];

      if (updates.status !== undefined) {
        fields.push("status = ?");
        params.push(updates.status);
      }

      if (updates.phase !== undefined) {
        fields.push("phase = ?");
        params.push(updates.phase);
      }

      if (updates.dayNumber !== undefined) {
        fields.push("day_number = ?");
        params.push(updates.dayNumber);
      }

      if (updates.roundNumber !== undefined) {
        fields.push("round_number = ?");
        params.push(updates.roundNumber);
      }

      if (updates.winner !== undefined) {
        fields.push("winner = ?");
        params.push(updates.winner);
      }

      if (updates.startedAt !== undefined) {
        fields.push("started_at = ?");
        params.push(updates.startedAt);
      }

      if (updates.finishedAt !== undefined) {
        fields.push("finished_at = ?");
        params.push(updates.finishedAt);
      }

      if (updates.durationMs !== undefined) {
        fields.push("duration_ms = ?");
        params.push(updates.durationMs);
      }

      if (updates.finalState !== undefined) {
        fields.push("final_state = ?");
        params.push(JSON.stringify(updates.finalState));
      }

      if (fields.length === 0) {
        console.warn("[DB] No fields to update in game");
        return;
      }

      params.push(gameId); // Add gameId as last parameter
      const query = `UPDATE games SET ${fields.join(", ")} WHERE id = ?`;
      const stmt = this.db.prepare(query);
      stmt.run(params);
      stmt.free();
      this.persist();

      console.log(`[DB] Updated game: ${gameId} (${fields.length} fields)`);
    } catch (error) {
      console.error("[DB] Failed to update game:", error.message);
      throw error;
    }
  }

  listGames(filters = {}) {
    try {
      let query = "SELECT * FROM games WHERE 1=1";
      const params = [];

      if (filters.status) {
        query += " AND status = ?";
        params.push(filters.status);
      }

      if (filters.winner) {
        query += " AND winner = ?";
        params.push(filters.winner);
      }

      if (filters.limit) {
        query += " ORDER BY created_at DESC LIMIT ?";
        params.push(filters.limit);
      } else {
        query += " ORDER BY created_at DESC";
      }

      const stmt = this.db.prepare(query);
      stmt.bind(params);

      // Get all rows
      const games = [];
      while (stmt.step()) {
        games.push(stmt.getAsObject());
      }
      stmt.free();

      return games.map((game) => ({
        ...game,
        config: JSON.parse(game.config_json),
        initialRoles: JSON.parse(game.initial_roles),
        finalState: game.final_state ? JSON.parse(game.final_state) : null,
      }));
    } catch (error) {
      console.error("[DB] Failed to list games:", error.message);
      throw error;
    }
  }

  // ==========================================
  // PLAYERS OPERATIONS
  // ==========================================

  createPlayer(playerData) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO players (
          game_id, player_id, player_name, assigned_role, is_alive,
          model, provider, joined_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run([
        playerData.gameId,
        playerData.playerId,
        playerData.playerName,
        playerData.assignedRole,
        playerData.isAlive !== undefined ? (playerData.isAlive ? 1 : 0) : 1,
        playerData.model || null,
        playerData.provider || null,
        playerData.joinedAt || Date.now(),
      ]);
      stmt.free();
      this.persist();

      console.log(
        `[DB] Created player: ${playerData.gameId}/${playerData.playerId}`,
      );
    } catch (error) {
      console.error("[DB] Failed to create player:", error.message);
      throw error;
    }
  }

  getPlayers(gameId) {
    try {
      const stmt = this.db.prepare("SELECT * FROM players WHERE game_id = ?");
      stmt.bind([gameId]);

      const players = [];
      while (stmt.step()) {
        const p = stmt.getAsObject();
        players.push({
          ...p,
          isAlive: p.is_alive === 1,
        });
      }
      stmt.free();

      return players;
    } catch (error) {
      console.error("[DB] Failed to get players:", error.message);
      throw error;
    }
  }

  updatePlayer(gameId, playerId, updates) {
    try {
      const fields = [];
      const params = [];

      if (updates.isAlive !== undefined) {
        fields.push("is_alive = ?");
        params.push(updates.isAlive ? 1 : 0);
      }

      if (updates.assignedRole !== undefined) {
        fields.push("assigned_role = ?");
        params.push(updates.assignedRole);
      }

      if (updates.model !== undefined) {
        fields.push("model = ?");
        params.push(updates.model);
      }

      if (updates.provider !== undefined) {
        fields.push("provider = ?");
        params.push(updates.provider);
      }

      if (fields.length === 0) {
        console.warn("[DB] No fields to update in player");
        return;
      }

      params.push(gameId, playerId);
      const query = `UPDATE players SET ${fields.join(", ")} WHERE game_id = ? AND player_id = ?`;
      const stmt = this.db.prepare(query);
      stmt.run(params);
      stmt.free();
      this.persist();

      console.log(
        `[DB] Updated player: ${gameId}/${playerId} (${fields.length} fields)`,
      );
    } catch (error) {
      console.error("[DB] Failed to update player:", error.message);
      throw error;
    }
  }

  // ==========================================
  // EVENTS OPERATIONS
  // ==========================================

  appendEvent(gameId, eventData) {
    try {
      // Get next sequence number
      const seqStmt = this.db.prepare(
        "SELECT MAX(sequence) as max_seq FROM events WHERE game_id = ?",
      );
      seqStmt.bind([gameId]);
      const results = [];
      while (seqStmt.step()) {
        results.push(seqStmt.getAsObject());
      }
      seqStmt.free();
      const nextSequence = (results[0]?.max_seq || 0) + 1;

      const stmt = this.db.prepare(`
        INSERT INTO events (
          game_id, sequence, event_type, timestamp_ms, private, payload
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run([
        gameId,
        nextSequence,
        eventData.event_type,
        eventData.timestamp || Date.now(),
        eventData.private !== undefined ? (eventData.private ? 1 : 0) : 0,
        JSON.stringify(eventData.payload || {}),
      ]);
      stmt.free();
      this.persist();

      console.log(
        `[DB] Appended event: ${gameId}#${nextSequence} (${eventData.event_type})`,
      );
      return nextSequence;
    } catch (error) {
      console.error("[DB] Failed to append event:", error.message);
      throw error;
    }
  }

  getEvents(gameId, options = {}) {
    try {
      let query = `
        SELECT sequence, event_type, timestamp_ms, private, payload
        FROM events
        WHERE game_id = ?
      `;

      const params = [gameId];

      if (options.since !== undefined) {
        query += " AND sequence > ?";
        params.push(options.since);
      }

      if (options.eventType) {
        query += " AND event_type = ?";
        params.push(options.eventType);
      }

      if (options.excludePrivate) {
        query += " AND private = 0";
      }

      query += " ORDER BY sequence ASC";

      if (options.limit) {
        query += " LIMIT ?";
        params.push(options.limit);
      }

      const stmt = this.db.prepare(query);
      stmt.bind(params);

      // Get all rows
      const events = [];
      while (stmt.step()) {
        events.push(stmt.getAsObject());
      }
      stmt.free();

      return events.map((event) => ({
        sequence: event.sequence,
        eventType: event.event_type,
        timestamp: event.timestamp_ms,
        private: event.private === 1,
        payload: JSON.parse(event.payload),
      }));
    } catch (error) {
      console.error("[DB] Failed to get events:", error.message);
      throw error;
    }
  }

  // ==========================================
  // SNAPSHOTS OPERATIONS
  // ==========================================

  createSnapshot(gameId, sequence, gameState) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO snapshots (
          game_id, sequence, game_state, created_at
        )
        VALUES (?, ?, ?, ?)
      `);

      stmt.run([gameId, sequence, JSON.stringify(gameState), Date.now()]);
      stmt.free();
      this.persist();

      console.log(`[DB] Created snapshot: ${gameId}#${sequence}`);
    } catch (error) {
      console.error("[DB] Failed to create snapshot:", error.message);
      throw error;
    }
  }

  getSnapshot(gameId, sequence) {
    try {
      const stmt = this.db.prepare(
        "SELECT * FROM snapshots WHERE game_id = ? AND sequence = ?",
      );
      stmt.bind([gameId, sequence]);

      // Get all rows
      const snapshots = [];
      while (stmt.step()) {
        snapshots.push(stmt.getAsObject());
      }
      stmt.free();

      if (!snapshots || snapshots.length === 0) {
        console.log(`[DB] Snapshot not found: ${gameId}#${sequence}`);
        return null;
      }

      const s = snapshots[0];
      return {
        id: s.id,
        gameId: s.game_id,
        sequence: s.sequence,
        gameState: JSON.parse(s.game_state),
        createdAt: s.created_at,
      };
    } catch (error) {
      console.error("[DB] Failed to get snapshot:", error.message);
      throw error;
    }
  }

  getLatestSnapshot(gameId) {
    try {
      const stmt = this.db.prepare(
        "SELECT * FROM snapshots WHERE game_id = ? ORDER BY sequence DESC LIMIT 1",
      );
      stmt.bind([gameId]);

      // Get all rows
      const snapshots = [];
      while (stmt.step()) {
        snapshots.push(stmt.getAsObject());
      }
      stmt.free();

      if (!snapshots || snapshots.length === 0) {
        return null;
      }

      const s = snapshots[0];
      return {
        id: s.id,
        gameId: s.game_id,
        sequence: s.sequence,
        gameState: JSON.parse(s.game_state),
        createdAt: s.created_at,
      };
    } catch (error) {
      console.error("[DB] Failed to get latest snapshot:", error.message);
      throw error;
    }
  }

  // ==========================================
  // UTILITY METHODS
  // ==========================================

  close() {
    if (this.db) {
      this.persist();
      this.db.close();
      this.db = null;
      console.log("[DB] Database connection closed");
    }
  }

  // Get stats about the database
  getStats() {
    try {
      const gamesStmt = this.db.prepare("SELECT COUNT(*) as count FROM games");
      const gameResults = [];
      while (gamesStmt.step()) {
        gameResults.push(gamesStmt.getAsObject());
      }
      gamesStmt.free();

      const eventsStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM events",
      );
      const eventResults = [];
      while (eventsStmt.step()) {
        eventResults.push(eventsStmt.getAsObject());
      }
      eventsStmt.free();

      const snapshotsStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM snapshots",
      );
      const snapshotResults = [];
      while (snapshotsStmt.step()) {
        snapshotResults.push(snapshotsStmt.getAsObject());
      }
      snapshotsStmt.free();

      return {
        games: gameResults[0]?.count || 0,
        events: eventResults[0]?.count || 0,
        snapshots: snapshotResults[0]?.count || 0,
        path: this.dbPath,
      };
    } catch (error) {
      console.error("[DB] Failed to get stats:", error.message);
      throw error;
    }
  }
}

// Singleton instance
let dbInstance = null;

async function getDatabase(dbPath) {
  if (!dbInstance) {
    dbInstance = new GameDatabase(dbPath);
    await dbInstance.connect();
  }
  return dbInstance;
}

module.exports = {
  GameDatabase,
  getDatabase,
};
