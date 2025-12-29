# Master TODO List - Specification vs Implementation Gaps

**Created**: December 29, 2025
**Last Updated**: December 29, 2025
**Status**: Active
**Total Items**: 42 TODO items

## 🎯 OVERALL STATUS

**Specification Coverage**: 65-70%
**Critical Missing**: 4 blocks
**High Priority Missing**: 3 items (Database Persistence complete, Strategic AI complete - see below)
**Medium Priority Missing**: 14 items
**Low Priority Missing**: 3 items

---

# PART 1: CRITICAL FEATURES (Missing from Game - BLOCKS)

## CATEGORY: Statistics & Scoring System

**Spec Reference**: specs/stats-and-scoring-system.md (1,749 lines)
**Priority**: CRITICAL
**Status**: ❌ ZERO IMPLEMENTATION

- [ ] **STAT-CRIT-1**: Implement token usage tracking per turn
  - Count tokens for every AI API call
  - Track input vs output tokens separately
  - Store per-player token usage
  - **Effort**: Medium
  - **Spec Lines**: 19-140

- [ ] **STAT-CRIT-2**: Implement API call metrics
  - Track API call latency per request
  - Track error rates and failure types
  - Record retry attempts and their outcomes
  - **Effort**: Medium
  - **Spec Lines**: 142-271

- [ ] **STAT-CRIT-3**: Create statistics database schema
  - Design SQLite tables for metrics
  - Implement database connection
  - Create migration scripts
  - **Effort**: Large
  - **Spec Lines**: 852-1,050

- [ ] **STAT-CRIT-4**: Implement per-model win rate tracking
  - Track wins/losses per model
  - Calculate win percentages
  - Store historical performance data
  - **Effort**: Medium
  - **Spec Lines**: 422-650

- [ ] **STAT-CRIT-5**: Create aggregated statistics system
  - Compute average game length
  - Track role survival rates
  - Calculate average rounds to win
  - **Effort**: Medium
  - **Spec Lines**: 652-750

## CATEGORY: Evidence & Case Building

**Spec Reference**: specs/split-pane-consciousness.md, specs/multi-agent-ai-architecture.md
**Priority**: CRITICAL
**Status**: ❌ NO IMPLEMENTATION

- [ ] **EVID-CRIT-1**: Implement evidence tracking system
  - Create EvidenceRecord data structure
  - Auto-extract evidence from THINK streams
  - Track evidence sources and timestamps
  - **Effort**: Large
  - **Spec Lines**: 262-380

- [ ] **EVID-CRIT-2**: Build case database for each player
  - Store accumulated evidence per target
  - Link evidence to game events
  - Enable evidence recall in prompts
  - **Effort**: Large
  - **Spec Lines**: 380-450

- [ ] **EVID-CRIT-3**: Implement suspicion scoring algorithm
  - Create `calculateSuspectMeter(state)` function
  - Analyze voting patterns
  - Track statement contradictions
  - **Effort**: Large
  - **Spec Lines**: 60-99 in role-mechanics.md

---

# PART 2: HIGH PRIORITY MISSING

## CATEGORY: Database Persistence

**Spec Reference**: specs/database-schema.md
**Priority**: HIGH

- [x] **DB-HIGH-1**: Implement SQLite integration ✅ COMPLETED
  - Connect SQLite database to game engine
  - Create game_events table
  - Create game_sessions table
  - **Effort**: Medium
  - **Spec Lines**: 1-50
  - **Implementation**: Used sql.js (pure JavaScript, no native bindings required)

- [x] **DB-HIGH-2**: Implement event persistence ✅ COMPLETED
  - Save all game events to database
  - Add timestamps and metadata
  - Enable event replay capability
  - **Effort**: Medium
  - **Implementation**: Events auto-saved via createGameEvent() with privacy flags

- [ ] **DB-HIGH-3**: Add cross-game analysis
  - Query historic game data
  - Generate comparative reports
  - Enable time-series analysis
  - **Effort**: Medium

## CATEGORY: Strategic AI

**Spec Reference**: specs/role-mechanics.md
**Priority**: HIGH
**Status**: ✅ ALL ITEMS COMPLETED

- [x] **AI-HIGH-1**: Implement mafia kill selection algorithm ✅ COMPLETED
  - Priority: Eliminate confirmed sheriff
  - Priority: Eliminate likely doctor
  - Priority: Eliminate high-suspicion town leader
  - **Effort**: Medium
  - **Spec Lines**: 60-99
  - **Implementation**: calculateMafiaKillPriority() with scoring based on role and behavior

- [x] **AI-HIGH-2**: Implement doctor protection strategy ✅ COMPLETED
  - Self-protection logic
  - Sheriff protection priority
  - Pattern variation to avoid detection
  - **Effort**: Medium
  - **Spec Lines**: 185-224
  - **Implementation**: calculateDoctorProtectionPriority() with risk assessment

- [x] **AI-HIGH-3**: Implement sheriff investigation strategy ✅ COMPLETED
  - Investigate most suspicious
  - Track already-investigated players
  - Re-check strategy verification
  - **Effort**: Medium
  - **Spec Lines**: 284-319
  - **Implementation**: calculateSheriffInvestigationPriority() with investigation tracking

- [x] **AI-HIGH-4**: Implement vigilante shot timing logic ✅ COMPLETED
  - Confidence level calculation
  - Game timing assessment (early, mid, late)
  - Sheriff information integration
  - One-shot preciousness logic
  - **Effort**: Medium
  - **Spec Lines**: 521-570
  - **Implementation**: calculateVigilanteShotDecision() with strategic hold-fire logic

## CATEGORY: Multi-Role Support

**Spec Reference**: specs/role-mechanics.md (lines 751-953)
**Priority**: HIGH

- [ ] **MULTI-HIGH-1**: Implement Sheriff+Mafia conflict resolution
  - Sheriff reports truth but not mafia identity
  - Private THINK vs public SAYS logic
  - Mafia team information sharing
  - **Effort**: High

- [ ] **MULTI-HIGH-2**: Implement Doctor+Mafia protection decisions
  - Selective protection (don't save teammates)
  - Pattern manipulation to hide alliance
  - Risk assessment for saves
  - **Effort**: High

- [ ] **MULTI-HIGH-3**: Implement Vigilante+Mafia conflict resolution
  - Risk calculation for shooting teammates
  - Internal conflict simulation
  - Decision impact on mafia team
  - **Effort**: High

---

# PART 3: MEDIUM PRIORITY MISSING

## CATEGORY: Persona Evolution

**Spec Reference**: specs/persona-system.md (lines 458-465)
**Priority**: MEDIUM

- [ ] **PERS-MED-1**: Implement emotional state updates
  - Happiness changes based on events
  - Stress increases with threats/accusations
  - Curiosity peaks on new information
  - **Effort**: Small

- [ ] **PERS-MED-2**: Make persona state affect decisions
  - High stress → more defensive/aggressive
  - Low happiness → less cooperative
  - High curiosity → asks more questions
  - **Effort**: Medium

## CATEGORY: Role Personality Variations

**Spec Reference**: specs/role-mechanics.md (lines 955-983)
**Priority**: MEDIUM

- [ ] **ROLE-MED-1**: Implement mafia personality variations
  - Aggressive (early accusations)
  - Subtle (defensive, rarely leads)
  - Opportunistic (waits to join)
  - **Effort**: Medium

- [ ] **ROLE-MED-2**: Implement doctor personality variations
  - Selfish (protects self often)
  - Altruistic (protects others)
  - Analytical (calculates optimal protection)
  - **Effort**: Medium

- [ ] **ROLE-MED-3**: Implement sheriff personality variations
  - Bold (reveals early)
  - Cautious (hides until late)
  - Strategic (reveals when mafia winning)
  - **Effort**: Medium

## CATEGORY: Context Management

**Spec Reference**: specs/multi-agent-ai-architecture.md (lines 400-450)
**Priority**: MEDIUM

- [ ] **CTX-MED-1**: Implement hierarchical context
  - Priority levels: critical vs optional
  - Context compression for long games
  - Relevance-based history inclusion
  - **Effort**: High

## CATEGORY: Cost Tracking

**Spec Reference**: specs/stats-and-scoring-system.md (lines 19-140)
**Priority**: MEDIUM

- [ ] **COST-MED-1**: Implement per-turn cost tracking
  - Track tokens × model pricing
  - Calculate cost per player per turn
  - Sum by phase (night/day)
  - **Effort**: Medium

- [ ] **COST-MED-2**: Implement budget tracking
  - Set player spend limits
  - Warn approaching limits
  - Stop play if exceeded
  - **Effort**: Small

## CATEGORY: Event Sourcing & Replay

**Spec Reference**: specs/multi-agent-ai-architecture.md (lines 68-73)
**Priority**: MEDIUM

- [ ] **EVENT-MED-1**: Implement game replay capability
  - Serialize all game events
  - Store event sequence
  - Enable replay from database
  - **Effort**: Medium

- [ ] **EVENT-MED-2**: Implement time-travel debugging
  - Restore game state at any event
  - Branch from historical point
  - Compare alternate outcomes
  - **Effort**: High

---

# PART 4: LOW PRIORITY ADVANCED FEATURES

## CATEGORY: Real-Time Dashboard

**Spec Reference**: specs/stats-and-scoring-system.md (lines 273-420)
**Priority**: LOW

- [ ] **DASH-LOW-1**: Create web dashboard interface
  - Live game metrics display
  - Real-time event feed
  - Player status cards
  - **Effort**: Large

- [ ] **DASH-LOW-2**: Implement A/B testing framework UI
  - Test group management
  - Variant comparison display
  - Statistical significance reporting
  - **Effort**: Large

## CATEGORY: Visualization

**Priority**: LOW

- [ ] **VIS-LOW-1**: Implement Three.js 3D visualization
  - Setup Three.js scene
  - Create character node visualization
  - Render interaction dynamics
  - **Effort**: Large
  - **Spec Lines**: multi-agent-ai-architecture.md 153-154

- [ ] **VIS-LOW-2**: Implement voice synthesis (TTS)
  - Text-to-speech for THINK/SAYS
  - Character voice variation
  - Audio playback system
  - **Effort**: Medium
  - **Spec Lines**: multi-agent-ai-architecture.md 154

---

# PART 5: SPECIFICATION UPDATES NEEDED (Game Features Missing from Specs)

## CATEGORY: CLI and Configuration Documentation

**Priority**: MEDIUM

- [ ] **SPEC-CLI-1**: Document CLI interface modes
  - `--custom` mode with detailed seeds
  - `--demo` mode with brief game
  - Default auto-generation mode
  - **Effort**: Small
  - **Game Lines**: 3589-3617

- [ ] **SPEC-CLI-2**: Document environment variables
  - MAX_CONTEXT_CHARS
  - MAX_RETRIES
  - RETRY_DELAY_MS
  - PERSONA_TEMPERATURE
  - ALLOW_MULTI_ROLE
  - **Effort**: Small
  - **Game Lines**: Constructor 1086-1109

## CATEGORY: Game Mechanics Documentation

**Priority**: MEDIUM

- [ ] **SPEC-GAME-1**: Document mafia persuasion mechanic
  - Vote switching during consensus
  - Random chance logic
  - Mafia influence calculations
  - **Effort**: Small
  - **Game Lines**: 1470-1574

- [ ] **SPEC-GAME-2**: Document retry logic
  - Parse failure retries
  - Network error retries
  - Exponential backoff
  - **Effort**: Small
  - **Game Lines**: 2188-2213

- [ ] **SPEC-GAME-3**: Document context window management
  - Character limit trimming
  - Complete message preservation
  - Remove from beginning strategy
  - **Effort**: Small
  - **Game Lines**: 2291-2317

- [ ] **SPEC-GAME-4**: Document mock response system
  - Phase-specific mock behaviors
  - Fallback when API unavailable
  - Development usage patterns
  - **Effort**: Small
  - **Game Lines**: 2238-2289

## CATEGORY: System Architecture Documentation

**Priority**: LOW

- [ ] **SPEC-SYS-1**: Document archetype library
  - Historical figures list
  - Fictional characters list
  - Anime characters list
  - Stereotypes list
  - **Effort**: Small
  - **Game Lines**: 606-755

- [ ] **SPEC-SYS-2**: Document game state tracking
  - vigilanteShotUsed flag
  - lastDoctorProtection memory
  - mafiaKillTarget storage
  - **Effort**: Small
  - **Game Lines**: 1079-1081

- [ ] **SPEC-SYS-3**: Document persona temperature controls
  - Temperature effect on diversity
  - Configuration and usage
  - **Effort**: Small
  - **Game Lines**: 1102, 2176

---

# METRICS SUMMARY

## Effort Estimates

- **CRITICAL items**: 5 (Large/Medium)
- **HIGH items**: 9 (High/Medium)
- **MEDIUM items**: 14 (High/Medium/Small)
- **LOW items**: 6 (Large/Medium/Small)

## Completion Status

- **TOTAL TODOs**: 42 items
- **Status Breakdown**:
  - Critical: 5 (12%)
  - High: 9 (21%)
  - Medium: 19 (45%)
  - Low: 6 (14%)
  - Specs: 3 (8%)

## Blocker Items

All specification features blocking production:

1. Statistics System (5 items)
2. Evidence & Case Building (3 items)
3. Database Persistence (3 items)
4. Strategic AI (4 items)

## Recommended Starting Order

PHASE 1: Database Persistence (3 items) - Foundation for everything else
PHASE 2: Statistics Tracking (5 items) - Enables all analytics
PHASE 3: Evidence System (3 items) - Enables strategic AI
PHASE 4: Strategic AI (4 items) - Makes game interesting
PHASE 5: Remaining features in priority order

---

## NEXT STEPS

1. ✅ Start PHASE 1: Database Persistence
2. Implement SQLite integration
3. Test persistence with simple game
4. Verify data structure
5. Move to PHASE 2

**Goal**: Complete all phases systematically to reach production readiness.
