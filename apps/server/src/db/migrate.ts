/**
 * Database Migration Script
 * 
 * Initializes and migrates the SQLite database for Mafia AI Benchmark.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MigrationResult {
  success: boolean;
  migrationsApplied: number;
  error?: string;
}

export class DatabaseMigrator {
  private db: Database.Database;
  private schemaPath: string;
  
  constructor(dbPath: string = ':memory:') {
    // Fresh clones have no data/ dir (gitignored): better-sqlite3 throws
    // "directory does not exist" unless we create the parent first.
    // ':memory:' and bare filenames (dirname '.') need no directory.
    if (dbPath !== ':memory:' && path.dirname(dbPath) !== '.') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.schemaPath = path.join(__dirname, '..', '..', 'src', 'db', 'schema.sql');
  }
  
  /**
   * Initialize database schema
   */
  initialize(): MigrationResult {
    try {
      // Read schema file
      const schema = fs.readFileSync(this.schemaPath, 'utf-8');
      
      // Execute schema
      this.db.exec(schema);
      
      // MAF-GAP-005 data backfill: legacy terminal STATE_CHANGE events were
      // stored as type GAME_STARTED. Idempotent — only rows still carrying the
      // terminal signature (phase GAME_OVER or a winner in data) are touched;
      // after the adapter fix no new rows match, so re-runs are no-ops.
      this.db.prepare(`
        UPDATE events SET type = 'GAME_ENDED'
        WHERE type = 'GAME_STARTED'
          AND (phase = 'GAME_OVER' OR json_extract(data, '$.winner') IS NOT NULL)
      `).run();
      
      // RELENG-MAFIA-20260928-04 data backfill: legacy ENDED games have a
      // NULL/empty games.winner because older runs predate the column write
      // (MAF-GAP-056 fixed the writer, not the store). Backfill the winner
      // from the most recent GAME_ENDED event's $.winner, only when it is
      // MAFIA or TOWN (UNKNOWN/absent stay NULL). Idempotent — only rows
      // still NULL/empty are touched; re-runs are no-ops.
      this.db.prepare(`
        UPDATE games SET winner = (
          SELECT json_extract(e.data, '$.winner')
          FROM events e
          WHERE e.game_id = games.id
            AND e.type = 'GAME_ENDED'
            AND json_extract(e.data, '$.winner') IN ('MAFIA', 'TOWN')
          ORDER BY e.rowid DESC
          LIMIT 1
        )
        WHERE status = 'ENDED'
          AND (winner IS NULL OR winner = '')
          AND (
            SELECT json_extract(e.data, '$.winner')
            FROM events e
            WHERE e.game_id = games.id
              AND e.type = 'GAME_ENDED'
              AND json_extract(e.data, '$.winner') IN ('MAFIA', 'TOWN')
            ORDER BY e.rowid DESC
            LIMIT 1
          ) IS NOT NULL
      `).run();

      // MAF-REV-002 data backfill: historical ENDED games from the
      // dead-endpoint era completed with real-looking VOTE/ACTION/SAYS
      // events but ZERO real token usage — every provider call fell back
      // to the engine's canned-mock responses (game-engine.js
      // getMockResponse, e.g. an invalid/placeholder key). DF-MAFIA-AI-
      // BENCHMARK-12 added the write-time flag for NEW games
      // (LegacyGameAdapter done handler); games completed BEFORE that fix
      // never got flagged, so the leaderboard still rewards the
      // parse-failure cluster (live 2026-09-30: gpt-4o-mini gamesPlayed
      // 2,673 at a 75.5% "win" rate with no provider call ever made).
      //
      // Signal choice — players.tokens_used is NOT reliable for legacy
      // games: it is backfilled from per-player usage only in newer games
      // (DF-12/MAF-GAP-043 era), so on the live DB it marks just 327 of
      // 3,148 ENDED games while token_usage.total_tokens > 0 marks 2,665.
      // A players-only rule would misclassify 2,338 REAL-usage games as
      // mock. token_usage is the authoritative per-model surface —
      // persistUsage (MAF-GAP-012) writes one row per model with the
      // bridge-reported totalTokens (0 for the tracker's config-derived
      // mock fallback rows) — and player_game_stats.tokens_used agrees
      // with it exactly (2,665 = 2,665). agent_sessions is empty for all
      // 3,148 ENDED games (written by the native agent path, not the
      // legacy bridge), so it carries no signal either way.
      //
      // Rule (mirrors the DF-12 detection — "every model usage row has
      // totalTokens === 0", per-game not global): an ENDED game with the
      // mock flag absent is flagged mock=1 iff NO usage row anywhere
      // carries tokens > 0. That covers both mock shapes: usage rows
      // present but all zero (DF-12's exact write-time case), and games
      // with no usage rows at all (the historical cluster the row names:
      // players exist, no usage row ever recorded tokens). Games with ANY
      // recorded real usage stay unflagged — conservative, matching the
      // write-time rule that never flags once per-player usage proves
      // play. One deliberate divergence from write-time: DF-12 requires
      // the usage payload to be PRESENT and stays unflagged on absent
      // data, but for completed historical games absence of any
      // positive-usage row IS the mock signal (there is no payload coming).
      //
      // Idempotent + auditable: only rows still missing BOTH $.mock and
      // $.mockBackfilledAt are touched; each flagged game is stamped with
      // $.mockBackfilledAt (boot epoch ms) as the version marker. Games
      // write-time-flagged by DF-12 (mock=1, no stamp) are never rewritten,
      // real-usage games never match the NOT EXISTS, so re-runs are no-ops
      // and the stamp is stable. Data-preserving — no rows deleted.
      this.db.prepare(`
        UPDATE games SET config = json_set(config,
          '$.mock', 1,
          '$.mockBackfilledAt', unixepoch() * 1000)
        WHERE status = 'ENDED'
          AND json_extract(config, '$.mock') IS NULL
          AND json_extract(config, '$.mockBackfilledAt') IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM token_usage t
            WHERE t.game_id = games.id AND t.total_tokens > 0
          )
          AND NOT EXISTS (
            SELECT 1 FROM players p
            WHERE p.game_id = games.id AND p.tokens_used > 0
          )
          AND NOT EXISTS (
            SELECT 1 FROM player_game_stats s
            WHERE s.game_id = games.id AND s.tokens_used > 0
          )
      `).run();

      console.log('✅ Database schema initialized successfully');
      
      return {
        success: true,
        migrationsApplied: 0,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Database initialization failed:', message);
      
      return {
        success: false,
        migrationsApplied: 0,
        error: message,
      };
    }
  }
  
  /**
   * Get database instance
   */
  getDatabase(): Database.Database {
    return this.db;
  }
  
  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
  
  /**
   * Get table info
   */
  getTables(): string[] {
    const result = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    
    return result.map(row => row.name);
  }
  
  /**
   * Get table row count
   */
  getTableCount(tableName: string): number {
    const result = this.db.prepare(
      `SELECT COUNT(*) as count FROM ${tableName}`
    ).get() as { count: number };
    
    return result.count;
  }
  
  /**
   * Vacuum/optimize database
   */
  vacuum(): void {
    this.db.exec('VACUUM');
    console.log('✅ Database vacuumed');
  }
}

/**
 * Create database instance and initialize
 */
export function createDatabase(dbPath?: string): DatabaseMigrator {
  const migrator = new DatabaseMigrator(dbPath);
  const result = migrator.initialize();
  
  if (!result.success) {
    throw new Error(`Failed to initialize database: ${result.error}`);
  }
  
  return migrator;
}

/**
 * Run migrations (placeholder for future migrations)
 */
export async function runMigrations(dbPath?: string): Promise<MigrationResult> {
  const migrator = new DatabaseMigrator(dbPath);
  
  try {
    // Initialize base schema
    const initResult = migrator.initialize();
    if (!initResult.success) {
      return initResult;
    }
    
    // Check if migrations table exists, create if not
    migrator.getDatabase().exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    
    // Get applied migrations
    const applied = migrator.getDatabase().prepare(
      'SELECT name FROM migrations ORDER BY id'
    ).all() as { name: string }[];
    
    const appliedNames = new Set(applied.map(m => m.name));
    
    // Check for new migrations
    // Future migrations would be added here
    
    console.log(`✅ Applied ${appliedNames.size} migrations`);
    
    return {
      success: true,
      migrationsApplied: appliedNames.size,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      migrationsApplied: 0,
      error: message,
    };
  }
}

export default DatabaseMigrator;
