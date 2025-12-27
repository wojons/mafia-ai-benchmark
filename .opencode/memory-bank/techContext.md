# Tech Context - Mafia AI Benchmark

## Technology Stack

### Backend
- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.x
- **Framework**: Custom Express.js server
- **Storage**: SQLite (better-sqlite3 for synchronous operations)
- **Real-time**: WebSocket (ws library)

### Frontend
- **Framework**: React 18+ with TypeScript
- **State Management**: React Context + useReducer (or Zustand if needed)
- **Styling**: Tailwind CSS (or custom CSS modules)
- **Build Tool**: Vite
- **Real-time**: WebSocket client

### CLI
- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.x
- **CLI Framework**: Commander.js or yargs
- **Terminal UI**: chalk, ora for spinners

### Development Tools
- **Package Manager**: pnpm (or npm)
- **Language Server**: TypeScript ESLint
- **Testing**: Vitest or Jest
- **Docker**: Docker + Docker Compose

## Project Structure

```
mafia-ai-benchmark/
├── server/                 # Backend server
│   ├── src/
│   │   ├── engine/         # FSM game engine (pure logic)
│   │   ├── agents/         # Agent policies (scripted + LLM adapter)
│   │   ├── storage/        # SQLite implementation + abstraction
│   │   ├── transport/      # REST + WebSocket
│   │   └── index.ts        # Server entry point
│   ├── package.json
│   └── tsconfig.json
├── cli/                    # CLI client
│   ├── src/
│   │   ├── commands/       # CLI command handlers
│   │   ├── ui/             # Terminal UI components
│   │   └── index.ts        # CLI entry point
│   ├── package.json
│   └── tsconfig.json
├── web/                    # Web client
│   ├── src/
│   │   ├── components/     # React components
│   │   │   ├── AgentCard.tsx
│   │   │   ├── AgentGrid.tsx
│   │   │   ├── GameFeed.tsx
│   │   │   ├── PhaseHeader.tsx
│   │   │   └── Controls.tsx
│   │   ├── hooks/          # Custom hooks (useGameStream, useReplay)
│   │   ├── state/          # Context + reducers
│   │   ├── types.ts
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── shared/                 # Shared code
│   ├── src/
│   │   ├── types/          # TypeScript types
│   │   ├── events/         # Event schemas
│   │   └── constants/      # Game constants
│   ├── package.json
│   └── tsconfig.json
├── tests/                  # Tests
│   ├── fsm.test.ts
│   ├── determinism.test.ts
│   └── agents.test.ts
├── docker/
│   ├── Dockerfile.server
│   ├── Dockerfile.web
│   └── docker-compose.yml
├── package.json            # Monorepo root
├── pnpm-workspace.yaml
├── PROMPT.md
└── README.md
```

## Development Setup

### Prerequisites
- Node.js 20+
- pnpm (or npm)
- Docker (optional, for containerized setup)

### Installation
```bash
pnpm install
```

### Running the Project

#### Option 1: Docker (Recommended)
```bash
docker-compose up
```

#### Option 2: Local Dev
```bash
# Terminal 1: Backend
cd server && pnpm dev

# Terminal 2: CLI
cd cli && pnpm dev attach <gameId>

# Terminal 3: Web
cd web && pnpm dev
```

### Building for Production
```bash
pnpm build
```

## Configuration

### Environment Variables
- `DATABASE_URL`: SQLite file path (default: `./data/mafia.db`)
- `PORT`: Server port (default: 3000)
- `WEB_PORT`: Web client port (default: 5173)
- `LLM_API_KEY`: Optional, for LLM-backed agents

### Agent Configuration
- Scripted agents: No config needed
- LLM agents: Set `LLM_API_KEY` and configure model name

### Game Configuration
- Player count: 10 (default, configurable)
- Mafia count: 3 (default, configurable)
- Seed: Auto-generated or specified

## API Endpoints

### REST API
- `POST /api/games` - Create new game
- `GET /api/games/:id` - Get game status
- `POST /api/games/:id/pause` - Pause game
- `POST /api/games/:id/resume` - Resume game
- `POST /api/games/:id/step` - Execute one step
- `GET /api/games/:id/export` - Export event log (JSONL)

### WebSocket
- `ws://localhost:3000/ws/:gameId` - Live event stream

## CLI Commands

### Creating a Game
```bash
mafiactl new --players 10 --mafia 3 --seed 123 --mode scripted
```

### Attaching to a Game
```bash
mafiactl attach <gameId> --follow
```

### Game Status
```bash
mafiactl status <gameId>
```

### Game Control
```bash
mafiactl pause <gameId>
mafiactl resume <gameId>
mafiactl step <gameId>
```

### Exporting Logs
```bash
mafiactl export <gameId> --format jsonl
```

## Key Dependencies

### Backend
- `express`: HTTP server
- `ws`: WebSocket server
- `better-sqlite3`: SQLite driver
- `zod`: Runtime type validation

### Frontend
- `react`: UI framework
- `react-dom`: React DOM renderer
- `@vitejs/plugin-react`: Vite React plugin
- `tailwindcss`: Styling

### CLI
- `commander`: CLI framework
- `chalk`: Terminal colors
- `ora`: Loading spinners

### Shared
- `typescript`: TypeScript compiler

## Technical Constraints

### Performance
- WebSocket events should not block UI
- Throttle renders for high-frequency streaming
- Efficient event replay (load in batches)

### Compatibility
- Node.js 20+ required
- Modern browsers (ES2020+)
- Docker optional

### Development
- TypeScript strict mode enabled
- ESLint for code quality
- Tests for critical paths

## Future Extensions

### Pluggable Agent Policies
- LLM integration (OpenAI, Anthropic, local models)
- Hybrid policies (scripted + LLM)
- Human-in-the-loop mode

### Advanced Roles
- Investigator, Jailer, Vigilante, etc.
- Role claiming mechanics
- Role blocking mechanics

### Multiplayer Support
- Human players can join
- Mixed human/AI games

### Recording/Highlights
- Auto-detect key moments
- Export highlight clips
- Video generation
