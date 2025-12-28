-- Mafia AI Benchmark Database Schema
-- SQLite database for game storage, events, and statistics

-- Games table
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  ended_at INTEGER,
  status TEXT NOT NULL DEFAULT 'SETUP',
  config TEXT NOT NULL,  -- JSON config
  winner TEXT,  -- 'MAFIA' or 'TOWN'
  duration INTEGER,
  day_count INTEGER,
  total_turns INTEGER,
  total_events INTEGER,
  total_tokens INTEGER,
  total_cost REAL
);

-- Players table
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  is_alive INTEGER NOT NULL DEFAULT 1,
  is_mafia INTEGER NOT NULL DEFAULT 0,
  join_order INTEGER NOT NULL,
  agent_id TEXT,
  provider TEXT,
  model TEXT,
  survived INTEGER,
  won INTEGER,
  tokens_used INTEGER DEFAULT 0,
  api_calls INTEGER DEFAULT 0,
  actions_taken INTEGER DEFAULT 0,
  correct_votes INTEGER DEFAULT 0,
  incorrect_votes INTEGER DEFAULT 0,
  role_performance REAL DEFAULT 0,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Events table (Event Sourcing)
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  type TEXT NOT NULL,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  visibility TEXT NOT NULL DEFAULT 'PUBLIC',
  actor_id TEXT,
  target_id TEXT,
  data TEXT NOT NULL,  -- JSON event data
  turn_number INTEGER NOT NULL,
  day_number INTEGER NOT NULL,
  phase TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Agent sessions table
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  phase TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT,  -- JSON response
  think TEXT,
  says TEXT,
  action_type TEXT,
  action_target TEXT,
  action_confidence REAL,
  tokens_used INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency INTEGER,
  cost REAL,
  provider TEXT,
  model TEXT,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Token usage tracking
CREATE TABLE IF NOT EXISTS token_usage (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost REAL,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- API calls tracking
CREATE TABLE IF NOT EXISTS api_calls (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  latency INTEGER NOT NULL,
  status_code INTEGER,
  error TEXT,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Player game statistics
CREATE TABLE IF NOT EXISTS player_game_stats (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  role TEXT NOT NULL,
  survived INTEGER,
  won INTEGER,
  tokens_used INTEGER,
  api_calls INTEGER,
  actions_taken INTEGER,
  correct_votes INTEGER,
  incorrect_votes INTEGER,
  role_performance REAL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Model aggregate statistics
CREATE TABLE IF NOT EXISTS model_aggregate_stats (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  games_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0,
  avg_role_performance REAL DEFAULT 0,
  avg_tokens_per_game INTEGER DEFAULT 0,
  avg_cost_per_game REAL DEFAULT 0,
  avg_duration INTEGER DEFAULT 0,
  last_used INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(provider, model)
);

-- Model matchups (head-to-head)
CREATE TABLE IF NOT EXISTS model_matchups (
  id TEXT PRIMARY KEY,
  model_a_provider TEXT NOT NULL,
  model_a TEXT NOT NULL,
  model_b_provider TEXT NOT NULL,
  model_b TEXT NOT NULL,
  games_played INTEGER DEFAULT 0,
  model_a_wins INTEGER DEFAULT 0,
  model_b_wins INTEGER DEFAULT 0,
  ties INTEGER DEFAULT 0,
  last_played INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(model_a_provider, model_a, model_b_provider, model_b)
);

-- Benchmark reports
CREATE TABLE IF NOT EXISTS benchmark_reports (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  config TEXT NOT NULL,  -- JSON benchmark config
  results TEXT NOT NULL,  -- JSON results
  generated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  format TEXT DEFAULT 'JSON'
);

-- Agent configurations
CREATE TABLE IF NOT EXISTS agent_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 2000,
  system_prompt TEXT,
  custom_instructions TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Player model assignments (scalable - any number of players)
CREATE TABLE IF NOT EXISTS player_model_assignments (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,  -- Can be NULL for role-based assignments
  player_name TEXT,          -- Human-readable name
  role TEXT,                 -- Role-based: 'MAFIA', 'DOCTOR', 'SHERIFF', 'VIGILANTE', 'VILLAGER', or NULL for specific
  player_index INTEGER,      -- 1-based index for ordering
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 500,
  priority INTEGER DEFAULT 0,  -- Higher priority assignments override lower
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Player configuration templates (reusable)
CREATE TABLE IF NOT EXISTS player_config_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  config TEXT NOT NULL,  -- JSON configuration
  is_default INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Model presets (for quick assignment)
CREATE TABLE IF NOT EXISTS model_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 500,
  use_case TEXT,  -- 'reasoning', 'deception', 'analysis', 'general'
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Bulk model assignments (groups of players)
CREATE TABLE IF NOT EXISTS bulk_model_assignments (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  assignment_type TEXT NOT NULL,  -- 'role', 'team', 'range', 'pattern'
  assignment_value TEXT NOT NULL, -- e.g., 'MAFIA', 'TOWN', '1-50', 'even'
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 500,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Game snapshots (for replay)
CREATE TABLE IF NOT EXISTS game_snapshots (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  phase TEXT NOT NULL,
  day_number INTEGER NOT NULL,
  state TEXT NOT NULL,  -- JSON game state
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_created ON games(created_at);
CREATE INDEX IF NOT EXISTS idx_events_game ON events(game_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_sequence ON events(game_id, sequence);
CREATE INDEX IF NOT EXISTS idx_players_game ON players(game_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_game ON token_usage(game_id);
CREATE INDEX IF NOT EXISTS idx_api_calls_game ON api_calls(game_id);
CREATE INDEX IF NOT EXISTS idx_model_stats ON model_aggregate_stats(provider, model);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_player ON agent_sessions(player_id);

-- Triggers for updating timestamps
CREATE TRIGGER IF NOT EXISTS update_agent_configs_timestamp 
AFTER UPDATE ON agent_configs
BEGIN
  UPDATE agent_configs SET updated_at = unixepoch() WHERE id = NEW.id;
END;
