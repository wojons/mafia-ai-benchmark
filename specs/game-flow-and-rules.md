# Game Flow & Rules Specification

## Game Overview

AI models play the Mafia social deduction game. Each model is assigned a persona, then a role, and plays through night/day cycles.

## Win Conditions (CHECKED EVERY ROUND TRANSITION)

**ALWAYS check at these points:**

- Start of Night (after day ends)
- Start of Day (after night ends)
- After any death

**Mafia wins:** When `mafia_count >= town_count`

- Town count = everyone NOT mafia (doctors, sheriffs, vigilantes, villagers)

**Town wins:** When `mafia_count = 0`

## Role Scaling Rules

### Minimum Players: 5

**5 players:**

- 1 Mafia
- 1 Doctor
- 1 Sheriff
- 2 Villagers (no Vigilante)

**6+ players:**

- Include 1 Vigilante
- Mafia count = floor(player_count / 4)
- Fill remaining with Villagers

**Example distributions:**

- 5 players: 1M, 1D, 1S, 2V
- 10 players: 2M, 1D, 1S, 1Vig, 5V
- 12 players: 3M, 1D, 1S, 1Vig, 6V
- 15 players: 3M, 2D, 2S, 1Vig, 7V

## Game Phases

### Night Phase

1. **Mafia Team Chat** (all mafia alive participate)
   - Mafia discuss and reach consensus on kill target
   - Can vote to kill, or not kill anyone
   - **Note:** Technically allowed to kill each other, but weird/undrivable
   - Continue until consensus or timeout

2. **Doctor Action** (each alive doctor)
   - Each doctor chooses one person to protect
   - Multiple doctors can save different people
   - **No rule against saving same person** by different doctors

3. **Sheriff Investigation** (each alive sheriff)
   - Each sheriff investigates one person
   - Result: Exact role (MAFIA, DOCTOR, SHERIFF, VIGILANTE, VILLAGER)
   - Can investigate anyone

4. **Vigilante Action** (only once per game)
   - Vigilante may shoot one person OR pass
   - Can shoot at any night (even night 1)
   - Limited to exactly ONE shot
   - Target dies unless saved by doctor

5. **Night Resolution**
   - Calculate deaths:
     - Mafia kill target dies UNLESS saved by ANY doctor
     - Vigilante target dies UNLESS saved by ANY doctor
   - Check win condition
   - Reveal deaths

### Day Phase

1. **Discussion Phase**
   - All alive players discuss (villagers, mafia pretending to be villagers)
   - Everyone shares what they know (or choose to withhold)
   - No special action restrictions

2. **Voting Phase**
   - Each alive player votes to lynch someone (or no lynch)
   - Majority vote = player eliminated (lynched)
   - Tie = no lynching

3. **Check Win Condition**
   - If win, game ends
   - If not, proceed to night

## Persona System

### Persona Generation (BEFORE Role Assignment)

**Process:**

1. Game starts, LLM is told: "Generate a persona for a social deduction game"
2. LLM chooses persona (any character: fictional, anime, real person, etc.)
3. LLM generates name for persona
4. **No game context provided yet** - LLM doesn't know it's playing Mafia

**Prompt Template:**

```
You are participating in a social deduction game. Create a persona:

- Pick a character (fictional, anime, historical, or invent your own)
- Generate a name
- Describe personality traits
- Describe communication style
- Describe any quirks or habits

Examples (not limitations):
- Sherlock Holmes (observant, analytical)
- Captain America (heroic, direct)
- Anime character (specific personality)
- Custom persona (your creation)
```

### Role Assignment (AFTER Persona Generated)

**Process:**

1. Persona is locked in
2. Role is assigned (MAFIA, DOCTOR, SHERIFF, VIGILANTE, VILLAGER)
3. System prompt for role is given
4. **Important:** Every role (including Mafia) gets the Villager prompt too
   - Police need to pretend to be villagers
   - Villager prompt = "how to behave as a villager in public"
   - Mafia prompt = "secret mafia instructions"

**System Prompt Stack:**

- Base game rules
- Villager behavior (everyone gets this)
- Role-specific behavior (Mafia, Doctor, Sheriff, Vigilante, or Villager only)

## Memory System

**What everyone knows:**

- Public statements (daytime discussions)
- Who voted for whom
- Who died and their revealed role
- Any information shared publicly

**Mafia knows:**

- All mafia team members
- All mafia chat (private discussions at night)
- Public day discussions

**Doctor knows:**

- Who they protected each night (private)

**Sheriff knows:**

- Investigation results (private)
- Can share if they choose

**Vigilante knows:**

- Who they shot (private)
- Can share if they choose

**What happens when asleep:**

- Town (doctors, sheriffs, vigilantes, villagers) = asleep at night
- Mafia = awake and chatting

**Important:**

- Town cannot see mafia chat while sleeping
- Mafia sees everything (their chat + day discussions)
- Doctor doesn't see sheriff's investigation unless shared
- Sheriff doesn't see doctor's protection unless shared

## Think → Speak Pattern

**Every interaction:**

1. **THINK** (private internal monologue, logged but not shared)
   - "I suspect X because..."
   - "I should protect Y because..."
   - "Mafia said Z, which means..."

2. **SPEAK** (public statement, shared with all awake players)
   - In character with persona
   - Following the rules of the game phase

**Logging:**

- Store both THINK and SPEAK
- Track statistics on thought patterns
- Analyze for improvement

## Statistics Tracking

**Per Game:**

- Winner (Mafia or Town)
- Player count
- Role distribution
- Number of rounds
- Deaths by role
- Total LLm calls
- Token usage
- Cost

**Per Player:**

- Model used (GPT-4o-mini, Claude, etc.)
- Role assigned
- Persona (for analysis)
- Survived or died
- Round of death
- Times suspected/voted for
- Voting patterns

**Aggregation:**

- Win rates by model
- Win rates by role
- Performance across game sizes
- Token efficiency
- Cost per game

## Architecture

### Game Engine (Shared)

- `game-engine.js` - Core game logic
- Used by both CLI and server
- No direct user input handling

### CLI

- `cli.js` - Command-line interface
- Sets up game configuration
- Calls game engine
- Displays output

### Server (HTTP/WebSocket)

- Server loads game engine module
- HTTP endpoints for game management
- WebSocket for real-time events
- SQLite database for persistence

### Shared Components

- Game engine is **one module**
- Both CLI and server import/use same game engine
- No duplicate logic
- Database accessed by both (can run independently or together)

## Next Steps

1. ✅ Create this spec
2. ✅ Implement dynamic role assignment
3. ⏳ Implement Think → Speak pattern for all interactions
4. ⏳ Set up proper memory system (who knows what)
5. ⏳ Implement proper persona generation (no seeds)
6. ⏳ Split game-engine.js into smaller files
7. ⏳ Set up statistics tracking (basic → advanced)
8. ⏳ Get HTTP version running again
9. ⏳ Ensure CLI and server use same game engine
