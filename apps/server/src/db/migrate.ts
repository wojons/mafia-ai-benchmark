/**
 * Database Migration Script
 * 
 * Initializes and migrates the SQLite database for Mafia AI Benchmark.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface MigrationResult {
  success: boolean;
  migrationsApplied: number;
  error?: string;
}

export class DatabaseMigrator {
  private db: Database.Database;
  private schemaPath: string;
  
  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.schemaPath = path.join(__dirname, 'schema.sql');
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
