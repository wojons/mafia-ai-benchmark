# Persona System - Mafia AI Benchmark

## 🎭 Overview

The Persona System adds rich, dynamic characters to the Mafia AI Benchmark. Each AI agent now has a unique persona that influences their communication, decision-making, and behavior throughout the game.

## ✨ Key Features

### 1. Dynamic Name Generation
- **Diverse Cultural Names**: Western, Eastern, Latin, Nordic, African naming conventions
- **Nickname Probability**: 20% chance of having a nickname (e.g., "James 'Sparky' Smith")
- **Unique Every Game**: Names are randomly generated from diverse pools

### 2. Persona Archetypes
Players are based on various archetypes:

| Category | Examples | Description |
|----------|----------|-------------|
| **Historical** | Julius Caesar, Cleopatra, Leonardo da Vinci, Genghis Khan | Famous figures with known traits |
| **Fictional** | Sherlock Holmes, Atticus Finch, Katniss Everdeen | Literary and film characters |
| **Anime** | Guts, Light Yagami, Naruto, Sailor Moon | Popular anime/manga archetypes |
| **Stereotypes** | Karen, Chad, Gary, Sandra | Common character tropes |
| **Abstract** | The Judge, The Fool, The Guardian | Archetypal roles |
| **Fantasy** | Gandalf, Aragorn, Yoda, Geralt | Fantasy/sci-fi icons |

### 3. Persona Components

Each persona includes:

```
🎭 [NAME] (Archetype)
   📝 Origin: [Backstory]
   💬 Communication: [Style] with [humor] humor
   ⭐ Traits: [trait1], [trait2], [trait3]
   🎯 Values: [value1], [value2]
   💔 Flaw: [personal weakness]
   🗣️ Verbal Tics: "[phrase1]", "[phrase2]"
   🎪 Hobby: [weekend activity]
```

### 4. Communication Styles

| Style | Cadence | Example |
|-------|---------|---------|
| **Formal** | Precise, measured | "Indeed, one must consider the implications..." |
| **Casual** | Relaxed, friendly | "Yo, honestly, like, you know what I mean?" |
| **Southern** | Slow, warm | "Well now, honey, don't you worry..." |
| **British** | Proper, understated | "Rather interesting, what? I daresay..." |
| **Gangster** | Tough, direct | "Look, see, here's the deal..." |
| **Valley Girl** | Exclamation-heavy | "Oh my God, like, seriously?!" |
| **Southern Gentleman** | Chivalrous | "My dear lady, allow me to offer..." |
| **Pirate** | Boisterous | "Ahoy me hearties! Shiver me timbers!" |

## 🎮 Integration with Game Flow

### During Player Creation
```javascript
const PersonaGenerator = require('./persona-generator.js');
const generator = new PersonaGenerator();

const personas = generator.generateGamePersonas(10);
// Returns array of 10 unique personas with roles
```

### During AI Prompts
Each AI call now includes the persona:

```javascript
const prompt = `You are ${player.name}, a ${player.role} in a Mafia game.

## YOUR PERSONA
You are ${persona.name}, based on ${persona.archetype}.

- Core Traits: ${persona.traits.join(', ')}
- Communication Style: ${persona.communicationStyle}
- Verbal Tics: ${persona.verbalTics.join(', ')}
- Background: ${persona.origin}
- Weakness: ${persona.flaw}

Speak in character! Use your verbal tics naturally.
`;
```

### Example AI Response
**Without Persona**:
```
THINK: I should vote to kill Alice.
SAYS: "I think we should eliminate Alice."
```

**With Persona (Julius Caesar archetype)**:
```
THINK: As a military commander, I must analyze tactical advantages. Alice's influence threatens our position. Better to eliminate her strategically.
SAYS: "Indeed, friends. From my experience leading campaigns, I observe that Alice poses the greatest tactical threat. We must act decisively."
```

## 📊 Persona Structure

```javascript
{
  // Core Identity
  name: "James 'Ace' Tanaka",
  zodiac: "Scorpio",
  origin: "Former military commander who led successful campaigns before retirement",
  
  // Psychological Profile
  archetype: "Julius Caesar",
  traits: ["Charismatic", "Strategic", "Ambitious"],
  cognitiveStyle: 5, // 1-10 scale
  thinkingMode: "Logical-Sequential",
  coreValues: ["Power", "Order", "Loyalty"],
  moralAlignment: "Lawful Neutral",
  
  // Behavioral Model
  communicationStyle: "formal and precise",
  verbalTics: ["Indeed", "Furthermore"],
  humor: "dry and intellectual",
  socialTendency: "Extroverted",
  conflictStyle: "Authoritative",
  
  // Daily Activities
  weekendActivity: "practicing martial arts",
  
  // Relational Profile
  goal: "To prove that leaders can change the world",
  flaw: "Prideful - struggles to admit when wrong",
  keyMemory: "The day James learned that trust is earned, not given",
  
  // Dynamic State (evolves during game)
  currentState: {
    happiness: 5,
    stress: 3,
    curiosity: 7,
    anger: 2
  },
  
  // Role-specific
  roleAdjustment: {
    secretGoal: "Eliminate town members while maintaining cover",
    hidingStrategy: "Play innocent and frame others"
  }
}
```

## 🔧 Technical Implementation

### File Structure
```
packages/shared/src/
├── persona/
│   ├── persona-generator.js      # Main generator
│   └── persona-tests.js          # Unit tests
├── __tests__/
│   └── personas/
│       └── persona.test.js       # Integration tests
```

### Key Classes

**PersonaGenerator**
```javascript
class PersonaGenerator {
  generateName()           // Create diverse names
  generatePersona(role)    // Generate single persona
  generateGamePersonas(n)  // Generate full game cast
  assignRoles(n)           // Assign Mafia/Town roles
}
```

### Role Adjustments
Each game role gets persona-specific guidance:

| Role | Secret Goal | Hiding Strategy |
|------|-------------|-----------------|
| **Mafia** | Eliminate town members | Play innocent OR frame others |
| **Doctor** | Protect key players | Publicly announce without revealing target |
| **Sheriff** | Identify mafia | Investigate subtly, share verified info |
| **Vigilante** | Eliminate suspected mafia | Wait for perfect moment |
| **Villager** | Find mafia through logic | Share observations, build coalitions |

## 📈 Benefits

### For Gameplay
- **Rich Roleplay**: Each game has unique characters
- **Consistent Behavior**: Personas maintain personality across phases
- **Emergent Story**: Character interactions create narratives
- **Better Hiding**: Personas help mafia blend in naturally

### For Testing
- **Diverse Scenarios**: Different personalities create varied game states
- **Edge Cases**: Test extreme personality combinations
- **Benchmarking**: Compare AI performance across persona types

### For Research
- **Personality Analysis**: Study how traits affect strategy
- **Communication Patterns**: Analyze different communication styles
- **Social Dynamics**: Observe group behavior with diverse personalities

## 🎯 Usage Examples

### Basic Usage
```javascript
const generator = new PersonaGenerator();

// Generate single persona
const persona = generator.generatePersona('MAFIA');
console.log(persona.name);
// Output: "Maria 'Sparky' García" (random example)

// Generate full game
const gamePersonas = generator.generateGamePersonas(10);
console.log(gamePersonas[0].name);
// Output: Random character name
```

### Integration with Game
```javascript
// Create game with personas
const personas = generator.generateGamePersonas(10);

const players = personas.map(persona => ({
  id: `player-${index}`,
  name: persona.name,
  role: persona.gameRole,
  isMafia: persona.gameRole === 'MAFIA',
  isAlive: true,
  persona: persona
}));

// Use in AI prompts
const prompt = createPrompt(player, gameState, phase);
// Persona automatically included in prompt
```

## 🧪 Testing

The persona system includes comprehensive tests:

```bash
cd packages/shared
npm test
```

**Test Coverage**:
- ✅ Name generation (diversity, no duplicates)
- ✅ Persona structure (all fields present)
- ✅ Communication styles (10 styles)
- ✅ Role adjustments (5 roles)
- ✅ Game persona generation (balanced teams)
- ✅ Integration with game engine

## 🔜 Future Enhancements

- **Persona Evolution**: Characters remember and reference past events
- **Relationship Mapping**: Track relationships between characters
- **Memory System**: Personas develop based on game events
- **Dynamic Verbal Tics**: New phrases added based on gameplay
- **Voice Integration**: Audio personality profiles

## 📝 Credits

Persona archetypes inspired by:
- Historical figures and leaders
- Classic and contemporary fiction
- Anime and manga characters
- Psychological personality frameworks
- Common social stereotypes

---

*Last Updated: December 28, 2025*
*Status: ✅ Implemented | ✅ Tested | 🎮 Ready for Games*
