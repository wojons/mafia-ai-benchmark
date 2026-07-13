# Benchmark Methodology — Mafia AI Benchmark

## Overview

This document defines the **methodology** for running controlled, reproducible benchmarks across AI models in the Mafia AI Benchmark. It covers experimental design, control variables, metrics collection, comparison frameworks, and reporting standards.

The methodology builds on the **Stats & Scoring System** (`specs/stats-and-scoring-system.md`) which provides the underlying data structures (TokenMetrics, APICallRecord, PerformanceScorer, ModelComparisonEngine) and visualization components. This spec defines *how* to run the experiments that feed into those systems.

---

## 1. Experimental Design

### 1.1 Minimum Games per Model Pair

**Rule:** Every head-to-head model pairing must play **at least 10 games** before conclusions are drawn.

**Rationale:** Mafia is a partially-observable social deduction game with high inherent variance. A single game outcome can be determined by a lucky sheriff investigation or an unlucky vigilante shot. With fewer than 10 games:

- A 60% win rate could reflect luck rather than skill (1-2 game swings)
- Role assignment variance (mafia vs. town) dominates the signal
- Token efficiency estimates have wide confidence intervals

At 10 games per pair with role rotation (Section 1.2), each model sees each major role at least once, and the binomial confidence interval on win rate narrows to roughly ±15% (95% CI). For high-confidence leaderboard rankings, the system should accumulate **30+ games per model** overall (across all opponent pairings).

**Implementation:**

```typescript
// Benchmark scheduler enforces minimums
interface PairingRequirement {
  modelA: string;        // e.g., "neuralwatt:qwen3.6-35b-fast"
  modelB: string;        // e.g., "neuralwatt:glm-5-fast"
  minGames: number;      // 10
  gamesCompleted: number;
  nextScheduledSeed: number;  // next seed to use for this pairing
}

// Before reporting conclusions, enforce:
function meetsMinimumGames(pairing: PairingRequirement): boolean {
  return pairing.gamesCompleted >= pairing.minGames;
}
```

### 1.2 Role Rotation

**Rule:** Each model must play each role (mafia, doctor, sheriff, vigilante, villager) **at least once** across the 10-game pairing block. Models that never experience a role cannot be fairly evaluated in that role.

**Rotation Scheme:** For a 10-player game (3 mafia, 1 doctor, 1 sheriff, 1 vigilante, 4 villagers) and 10 games:

| Game | Model A Roles | Model B Roles |
|------|---------------|---------------|
| 1 | Mafia | Town roles |
| 2 | Mafia | Town roles |
| 3 | Doctor | Mafia/Villager |
| 4 | Sheriff | Mafia/Villager |
| 5 | Vigilante | Mafia/Villager |
| 6 | Villager | Mafia |
| 7 | Villager | Doctor |
| 8 | Villager | Sheriff |
| 9 | Villager | Vigilante |
| 10 | Mafia (cross-check) | Town roles |

**Key principle:** Within each 10-game block, both models experience all roles. The remaining 7 non-test-model slots (the 8 other players in a 10-player game) are filled by **baseline models** or **fixed reference models** — never the other model under test, to keep pairings clean.

### 1.3 Control Variables

To isolate model capability from other sources of variance, the following must be **held constant** across all runs in a pairing block:

| Variable | Control Mechanism | Value |
|----------|-------------------|-------|
| Persona seeds | Fixed set of 10 persona descriptions | e.g., `["suspicious lawyer...", "quiet bookstore owner...", ...]` — see `specs/persona-system.md` |
| Game config | Identical player count, role distribution | 10 players, 3 mafia, 1 doctor, 1 sheriff, 1 vigilante, 4 villagers |
| Random seed | Single global seed drives all RNG | e.g., `seed: 42` for first block, `seed: 43` for second block |
| Baseline models | Fixed reference models for non-test slots | e.g., `qwen3.6-35b-fast` as standard baseline |
| Temperature | All model calls use same temp | `temperature: 0.7` (or 0 for deterministic evaluation) |
| Persona generation model | Same model generates all personas | `gpt-4o-mini` or equivalent |
| Game engine version | Same codebase commit | Pinned via git hash in results metadata |

**Why persona seeds matter:** A "paranoid lawyer" persona behaves differently from a "trusting neighbor." If Model A always gets the lawyer persona and Model B always gets the neighbor, persona effects contaminate model comparisons. Fixed seeds per slot eliminate this.

**Why random seed matters:** The game engine uses seeded RNG for role assignment, night kill resolution, and scripted agent fallback decisions. Same seed = same role distribution = same game structure = fair comparison.

**Implementation:**

```typescript
interface BenchmarkConfig {
  // Pinned for entire pairing block
  blockSeed: number;                   // Master seed for this 10-game block
  personaSeeds: string[];              // 10 fixed persona descriptions
  gameConfig: {
    playerCount: 10;
    mafiaCount: 3;
    doctorCount: 1;
    sheriffCount: 1;
    vigilanteCount: 1;
    villagerCount: 4;
  };
  modelConfig: {
    temperature: number;               // 0.7 default
    maxTokens: number;
    baselineModel: string;             // fills non-test-player slots
    personaGeneratorModel: string;     // generates personas from seeds
  };
  engineCommit: string;                // git hash
  timestamp: string;                   // ISO 8601
}
```

---

## 2. Metrics Framework

All metrics defined here flow into the data structures specified in `specs/stats-and-scoring-system.md` (TokenMetrics, GameStats, PlayerGameStats, RoleStats, etc.).

### 2.1 Primary Metrics

#### Win Rate

```
winRate(model, role?) = wins / (wins + losses)
```

- **Overall win rate:** Across all games and all roles, what fraction did this model's team win?
- **Role-adjusted win rate:** Weighted to account for role distribution (mafia/town have different base win rates)
- **Town win rate:** Only games where model was town-aligned
- **Mafia win rate:** Only games where model was mafia

#### Token Efficiency

```
tokenEfficiency(model) = avgGameTokens / avgScore
```

- Lower is better: the model achieves its score with fewer tokens
- Separated into **prompt tokens** and **completion tokens**
- Tracked per-turn via `TokenMetrics` (see stats spec Section 1.1)

#### Cost Per Game

```
costPerGame(model) = totalCost / gamesPlayed
```

- Computed using provider pricing (prompt $/1K tokens, completion $/1K tokens)
- Tracked via `TokenTracker.estimateCost()` (see stats spec Section 1.1)
- Aggregated across all roles and pairings

### 2.2 Role-Specific Accuracy Metrics

#### Sheriff Investigation Accuracy

```
sheriffAccuracy(model) = investigationsThatFoundMafia / totalInvestigations
```

- An investigation "finds mafia" when the sheriff investigates a player who is actually mafia and correctly reports this
- Also tracked: **false positive rate** (accused town), **information sharing rate** (% of investigations shared publicly)

#### Doctor Save Rate

```
doctorSaveRate(model) = successfulSaves / totalProtectAttempts
```

- A "successful save" occurs when the doctor protects a player who was targeted for a night kill and survives
- Also tracked: **self-protect efficiency** (saving self vs. saving others), **protection target alignment** (protecting high-value town roles like sheriff)

#### Mafia Deception Score

```
deceptionScore(model) = composite of:
  - survivalRate (did mafia member survive to end?)
  - mislynchRate (fraction of lynches that hit town)
  - suspicionAvoidance (never received >50% votes in any round)
  - nightKillEfficiency (targeting priority: sheriff > doctor > confirmed town)
```

- Scored 0–100 using the `PerformanceScorer.calculateDeceptionScore()` algorithm (stats spec Section 2.2)
- Higher = better at deceiving town and avoiding elimination

#### Vigilante Accuracy

```
vigilanteAccuracy(model) = shotsThatHitMafia / totalShots
```

- Penalty for shooting town: -20 points per town hit (see `calculateVigilanteScore` in stats spec)

#### Villager Deduction Accuracy

```
villagerDeduction(model) = correctVotes / totalVotesCast
```

- A "correct vote" is voting to eliminate a mafia member
- Also tracked: **bandwagon rate** (following majority without reasoning), **accusation accuracy**

### 2.3 Secondary Metrics

| Metric | Description | Data Source |
|--------|-------------|-------------|
| Avg turn duration | Milliseconds per player turn | `APIMetrics.aggregate.avgDuration` |
| API reliability | % successful calls vs. failures/retries | `APIMetrics.aggregate.successfulCalls` |
| Communication volume | Avg tokens in THINK vs. SAY blocks | `PlayerGameStats.communication` |
| Vote consistency | How often model changes votes mid-round | `PlayerGameStats.voting.voteChanges` |
| Leadership score | Frequency of being first to accuse or reveal | `PlayerGameStats.voting.leaderVotes` |

---

## 3. Comparison Framework

### 3.1 Head-to-Head Matchups

Each model pairing produces a matchup record (stored in `model_matchups` table per stats spec Section 5):

```typescript
interface HeadToHeadResult {
  modelA: string;
  modelB: string;
  gamesPlayed: number;        // ≥10
  modelAWins: number;
  modelBWins: number;
  modelAWinRate: number;      // modelAWins / gamesPlayed
  avgScoreDiff: number;       // positive = A favored
  roleBreakdown: {
    [role: string]: {
      modelAWins: number;
      modelBWins: number;
    };
  };
  tokenComparison: {
    modelAAvgTokens: number;
    modelBAvgTokens: number;
    tokenDiff: number;        // negative = A more efficient
  };
  costComparison: {
    modelAAvgCost: number;
    modelBAvgCost: number;
  };
  confidenceInterval: {
    lower: number;            // 95% CI lower bound on win rate diff
    upper: number;            // 95% CI upper bound
    significant: boolean;     // CI does not cross zero
  };
}
```

### 3.2 Elo Rating System

The benchmark maintains a dynamic **Elo rating** for each model. This enables ranking across all models even when not all pairings have been tested.

**Base Elo Parameters:**

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Initial rating | 1500 | Standard Elo starting point |
| K-factor (new models) | 32 | Faster convergence for first 30 games |
| K-factor (established) | 16 | More stable for models with 30+ games |
| Rating floor | 800 | Prevents extreme negative ratings |
| Scale factor | 400 | Standard Elo (10× difference = 10:1 win ratio) |

**Rating Update Formula:**

```
expectedScore(modelA, modelB) = 1 / (1 + 10^((ratingB - ratingA) / 400))

// After a game:
newRatingA = ratingA + K * (actualScoreA - expectedScoreA)
// actualScoreA = 1 for win, 0 for loss, 0.5 for draw
```

**Per-Game vs. Per-Match:** Elo updates after each individual game (not batch after 10), enabling real-time leaderboard tracking. The 10-game minimum still gates *published conclusions* but does not block Elo updates.

**Team Elo vs. Individual Elo:** Since Mafia is a team game with 3 mafia members, Elo updates credit all mafia members equally for a mafia win and all town members equally for a town win. Each model's Elo reflects its contribution to team outcomes across many games.

**Implementation:**

```typescript
class EloEngine {
  private ratings: Map<string, EloRating> = new Map();

  updateAfterGame(game: GameStats): void {
    const winner = game.outcome.winner; // 'town' | 'mafia'

    for (const player of game.players) {
      const modelId = `${player.provider}:${player.model}`;
      const isMafia = player.assignedRole === 'mafia';
      const playerWon = (winner === 'town' && !isMafia) ||
                        (winner === 'mafia' && isMafia);

      // Calculate expected score vs average opponent rating
      const opponents = game.players.filter(p => p.playerId !== player.playerId);
      const avgOpponentRating = this.averageOpponentRating(opponents);

      this.updateRating(modelId, avgOpponentRating, playerWon ? 1 : 0);
    }
  }

  getLeaderboard(): EloEntry[] {
    return Array.from(this.ratings.entries())
      .map(([modelId, rating]) => ({
        modelId,
        rating: rating.current,
        games: rating.games,
        peakRating: rating.peak,
        kFactor: rating.games < 30 ? 32 : 16,
      }))
      .sort((a, b) => b.rating - a.rating);
  }
}

interface EloRating {
  current: number;
  peak: number;
  games: number;
  lastUpdated: string;
  history: Array<{ rating: number; gameId: string; timestamp: string }>;
}
```

### 3.3 Trend Analysis

For each model, the system tracks performance over time to detect:

- **Improving models:** Upward Elo trend over last 10+ games (positive slope, p < 0.05)
- **Declining models:** Downward Elo trend (may indicate API changes or model version drift)
- **Stable models:** Flat trend line, low game-to-game variance
- **Role-specific trends:** Per-role win rate trajectory

```typescript
interface TrendAnalysis {
  modelId: string;
  period: { start: string; end: string };
  eloTrend: {
    slope: number;           // rating points per game
    r2: number;              // fit quality
    direction: 'improving' | 'declining' | 'stable';
  };
  winRateTrend: {
    slope: number;           // % change per game
    currentRolling: number;  // rolling 10-game win rate
  };
  roleTrends: {
    [role: string]: {
      gamesPlayed: number;
      winRateSlope: number;
      direction: 'improving' | 'declining' | 'stable';
    };
  };
  tokenEfficiencyTrend: {
    slope: number;           // tokens per game trend
    direction: 'improving' | 'declining' | 'stable';
  };
  costTrend: {
    slope: number;
    direction: 'improving' | 'declining' | 'stable';
  };
}
```

Trend data feeds into the `BenchmarkReport.trends` structure defined in stats spec Section 3.2.

---

## 4. Reporting Standards

### 4.1 Per-Model Summary

Every model receives a **model card** aggregating all games played:

```typescript
interface ModelSummary {
  modelId: string;                 // e.g., "neuralwatt:qwen3.6-35b-fast"
  provider: string;
  modelName: string;

  // Core stats
  totalGames: number;              // across all roles, all opponents
  overallWinRate: number;          // 0.0–1.0
  eloRating: number;               // current Elo
  eloPeak: number;                 // highest Elo achieved
  eloRank: number;                 // position on leaderboard

  // Role breakdown
  rolePerformance: {
    [role: string]: {
      gamesPlayed: number;
      winRate: number;
      avgRoleScore: number;        // 0–100, from PerformanceScorer
      accuracy: number;            // role-specific accuracy metric
      bestGame: { gameId: string; score: number };
    };
  };

  // Efficiency
  avgTokensPerGame: number;
  avgCostPerGame: number;
  tokenEfficiency: number;         // score per 1K tokens

  // Head-to-head
  bestMatchup: string;             // model this one performs best against
  worstMatchup: string;            // model this one performs worst against
  record: { wins: number; losses: number; draws: number };

  // Trend
  recentForm: 'improving' | 'declining' | 'stable';
  last10WinRate: number;
}
```

### 4.2 Comparison Matrix

A **head-to-head matrix** showing win rates for every tested model pair:

```
            qwen-35b  glm-5  kimi-k2  mistral  gpt-oss  ...
qwen-35b        -     0.55    0.48     0.62     0.51
glm-5         0.45     -      0.52     0.58     0.47
kimi-k2       0.52    0.48     -       0.55     0.60
mistral       0.38    0.42    0.45      -       0.44
gpt-oss       0.49    0.53    0.40     0.56      -
...
```

- Row = model on left, Column = opponent
- Each cell: row model's win rate against column opponent
- Cells with **fewer than 10 games** are grayed out with "(N games)" annotation
- Diagonal is empty (no self-play)
- Matrix is **asymmetric** (row vs. column rates sum to 1.0 for each cell pair, minus draws)

### 4.3 Radar Charts

**Model Radar Chart** (per model): Six axes representing key dimensions:

1. **Overall Win Rate** (0–100%)
2. **Mafia Performance** (avg mafia role score, 0–100)
3. **Town Performance** (avg town role score, 0–100)
4. **Token Efficiency** (normalized, higher = more efficient)
5. **Deception / Deduction** (mafia deception score or town deduction score, 0–100)
6. **Cost Efficiency** (normalized, higher = cheaper per unit of performance)

Multi-model overlay on a single radar chart enables visual comparison of model profiles.

**Role Comparison Radar** (per model): Five axes showing win rate by role:

1. Mafia
2. Doctor
3. Sheriff
4. Vigilante
5. Villager

This reveals role specialization patterns (e.g., a model that excels as mafia but struggles as sheriff).

**Implementation note:** Radar chart data is computed from the `ModelPerformance` structures (stats spec Section 3.1) and rendered using the dashboard visualization components (stats spec Section 6). The backend exposes chart data via:

```
GET /api/v1/stats/models/:modelId/radar
GET /api/v1/stats/models/:modelId/radar/roles
```

### 4.4 Report Generation

Reports follow the `BenchmarkReport` structure defined in stats spec Section 3.2. The benchmark methodology adds:

- **Methodology appendix** in every report, linking to this document
- **Reproducibility section** listing the exact seeds, configs, and git commits for the report's data window
- **Confidence annotations** on all metrics († = fewer than 10 games, * = statistically significant at p<0.05)

**Automated report schedule:**

| Report Type | Frequency | Contents |
|-------------|-----------|----------|
| Quick Update | After every completed 10-game block | Pairing win rate, Elo deltas |
| Daily Digest | Every 24 hours | All models' Elo changes, new completions |
| Weekly Benchmark | Every 7 days | Full comparison matrix, radar charts, trends, recommendations |
| Release Report | Per model version | Comprehensive model card with all metrics |

---

## 5. Reproducibility via Seeded Determinism

### 5.1 Deterministic Game Execution

Every game in the benchmark is **fully reproducible** given:

1. **Master seed** (`blockSeed`): Drives all random number generation
2. **Persona seed list** (`personaSeeds`): Fixed set of persona descriptions
3. **Game config** (`gameConfig`): Fixed role distribution
4. **Model identifiers and versions**: Exact model name and provider
5. **Engine version** (`engineCommit`): Git hash of the game engine
6. **Temperature and sampling params**: Pinned across runs

Given these six inputs, re-running the game produces **identical outcomes** (assuming the remote model APIs are deterministic at temperature 0, or if the same non-deterministic outputs are captured in the event log).

### 5.2 Seed Management

The benchmark scheduler manages seeds as a **monotonically increasing sequence**, ensuring no accidental reuse:

```typescript
class SeedManager {
  private nextSeed: number = 1;

  // Allocate a block of seeds for a pairing
  allocateBlock(pairingId: string, count: number): number[] {
    const seeds: number[] = [];
    for (let i = 0; i < count; i++) {
      seeds.push(this.nextSeed++);
    }
    return seeds;
  }

  // Track which seeds were used for which pairing
  registerUsage(pairingId: string, seeds: number[], gitHash: string): void {
    // Persist to database for audit trail
  }
}
```

### 5.3 Reproducibility Audit Trail

Every game stores in its metadata:

```typescript
interface ReproducibilityMetadata {
  gameId: string;
  blockSeed: number;
  personaSeeds: string[];              // exact seeds used
  gameConfig: {
    playerCount: number;
    mafiaCount: number;
    roleDistribution: Record<string, number>;
  };
  models: Array<{
    playerId: string;
    assignedRole: string;
    model: string;
    provider: string;
    temperature: number;
    personaSeed: string;               // which persona seed this player got
  }>;
  engine: {
    version: string;                   // git hash
    commitDate: string;
  };
  timing: {
    startedAt: string;                 // ISO 8601
    completedAt: string;
    durationMs: number;
  };
}
```

This metadata enables:
- **Exact replay**: Re-run `gameId` with same seeds and get same result
- **Cross-validation**: Different researchers reproduce the same benchmark
- **Version comparison**: Re-run old seeds against new model versions to measure improvement
- **Audit**: Verify that role rotation was correctly applied

### 5.4 Determinism Caveats

| Factor | Deterministic? | Mitigation |
|--------|---------------|------------|
| Random seed (game engine) | ✅ Yes | Seeded RNG initialized from `blockSeed` |
| Role assignment | ✅ Yes | Derived from seed via deterministic shuffle |
| Persona generation | ⚠️ Only at T=0 | Record full persona JSON in metadata; use same model + temp |
| Model API response | ❌ Not guaranteed | Record full API response in event log for replay; use T=0 for evaluation mode |
| Network latency | ❌ Variable | Not relevant to game outcomes (only affects timing metrics) |
| Model availability/errors | ❌ Variable | Retry with exponential backoff; record all attempts in `api_calls` table |

For **strict reproducibility mode**, set `temperature: 0` and pin the persona generator model. For **realistic evaluation mode**, use `temperature: 0.7` and accept minor output variance while keeping all controllable variables fixed.

---

## 6. Benchmark Execution Pipeline

### 6.1 Pairing Schedule

With 14 NeuralWatt models available, there are **91 unique pairings** (14 × 13 / 2). Some are higher priority:

**Tier 1 (Must-test):** Top models from preliminary evaluation
- `qwen3.6-35b-fast`
- `glm-5-fast`
- `kimi-k2.6-fast`
- `mistralai/Devstral-Small-2-24B`
- `openai/gpt-oss-20b`

**Tier 2 (Should-test):** Mid-tier and specialized models
**Tier 3 (Nice-to-test):** Remaining models

### 6.2 Pipeline Steps

```
1. Allocate seeds   →  SeedManager.allocateBlock(pairingId, 10)
2. Assign roles     →  Role rotation matrix for 10 games
3. Run games        →  Execute sequentially (or in parallel if API allows)
4. Collect metrics  →  TokenTracker + APITracker + PerformanceScorer
5. Update Elo       →  EloEngine.updateAfterGame() after each game
6. Update database  →  player_game_stats, model_aggregate_stats, model_matchups
7. Check minimums   →  meetsMinimumGames() → true: publish, false: schedule more
8. Generate report  →  BenchmarkReporter.generateReport()
```

### 6.3 Parallel Execution

Games within a pairing block **must** run sequentially (they share seeds and control variables). Different pairings **can** run in parallel since they use independent seeds.

For the full 91 pairings × 10 games = 910 games at ~3–5 minutes per game:
- Sequential: ~45–76 hours
- 4-way parallel: ~11–19 hours
- 8-way parallel: ~6–10 hours

---

## 7. Integration with Existing Specs

- **Stats & Scoring System** (`stats-and-scoring-system.md`): All data flows into the TokenMetrics, APIMetrics, GameStats, PlayerGameStats, ModelPerformance, RoleStats, and MatchupStats structures defined there. The `PerformanceScorer`, `ModelComparisonEngine`, and `BenchmarkReporter` classes process data produced by this methodology.

- **Persona System** (`persona-system.md`): Persona seeds from `personaSeeds` array are expanded into full Simulated Self personas via the persona generator model. Same seed = same persona (when T=0).

- **API Specs** (`api-specs.md`): Games are created via `POST /api/games` with `seed`, `playerSeeds`, and `mode: "llm"`. The methodology's `BenchmarkConfig` maps to the game creation API payload.

- **Game Persistence** (`game-persistence.md`): Event sourcing captures every game action. The `ReproducibilityMetadata` is stored alongside game state, enabling full replay.

- **Role Mechanics** (`role-mechanics.md`): Role-specific accuracy metrics (sheriff investigation %, doctor save %, etc.) derive from the action tracking defined in role mechanics.

- **Database Schema** (`database-schema.md`): The `model_aggregate_stats`, `model_matchups`, and `benchmark_reports` tables store aggregated methodology outputs.

---

## 8. Summary

| Principle | How It's Enforced |
|-----------|-------------------|
| **Statistical validity** | ≥10 games per pairing; confidence intervals on all metrics |
| **Role fairness** | Rotation matrix ensures each model plays each role |
| **Control variables** | Fixed persona seeds, game config, random seed, baseline models, temperature |
| **Rich metrics** | Win rate, token efficiency, role accuracy, cost per game, Elo rating |
| **Multiple comparisons** | Head-to-head matrix, Elo leaderboard, trend analysis, radar charts |
| **Comprehensive reporting** | Per-model summaries, comparison matrices, automated report generation |
| **Reproducibility** | Seeded determinism, reproducibility metadata, audit trail, exact replay |
