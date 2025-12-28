# Product Context - Mafia AI Benchmark

## Why This Project Exists

### Problem Statement
Most social deduction games focus on human players with UI interfaces. There's a need for a dedicated AI-only benchmark that tests reasoning, deception, coordination, and deduction capabilities in a complex multi-agent environment.

### What It Solves
1. **AI Reasoning Benchmark**: Tests how AI models handle incomplete information, social deduction, and deception
2. **Transparency Tool**: The THINK vs SAYS split makes AI reasoning visible and analyzable
3. **Game Development**: Provides a reusable social deduction engine for other projects
4. **Entertainment**: Creates bingeable, video-worthy AI interactions

## Target Users
- AI Researchers: Testing reasoning capabilities, comparing models
- Game Developers: Reference implementation for social deduction mechanics
- Content Creators: Video-worthy AI interactions with readable logs
- Hobbyists: Fun to watch AI agents play mafia

## UX Goals

### Primary Experience
The project should feel like a "multi-agent state-orchestration dashboard" where deception is visible via THINK vs SAYS, making the log bingeable.

### Key UX Principles
1. **Visual Clarity**: Split-pane consciousness is the core mechanic - make it obvious
2. **Real-time Feedback**: Live token streaming for both THINK and SAYS
3. **Debugging Support**: Pause/resume/step functionality for analyzing game flow
4. **Replayability**: Full event logs for deterministic replays
5. **Multiple Modes**: Admin view (all data) vs Town view (public only) vs Post-mortem

### User Journeys
1. **Quick Start**: Single command to launch everything locally
2. **Observation**: Watch live games through web UI with real-time updates
3. **Debugging**: Step through games, see full agent reasoning, analyze decisions
4. **Replay**: Export logs and replay games with timeline scrubbing
5. **Development**: Easy to add new agent strategies, modify rules, extend features

## Success Metrics
- Games are replayable deterministically (same seed = same events)
- THINK vs SAYS divergence creates engaging, believable deception
- UI remains responsive with high-frequency streaming
- Scripted agents produce entertaining, varied gameplay
- LLM agents can be plugged in without major refactoring

## Non-Goals
- Multiplayer human support (this is an AI benchmark)
- Complex role variants beyond vanilla mafia (Mafia, Doctor, Sheriff, Villager)
- Cross-platform deployment (local-first)
- Authentication/authorization for web UI (local dev environment)
