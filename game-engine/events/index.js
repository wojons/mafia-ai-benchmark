// ============================================
// EVENTS MODULE
// Event creation and prompt generation
// ============================================

// ============================================
// GAME EVENT CREATOR
// ============================================

function createGameEvent(
  gameId,
  round,
  phase,
  player,
  eventType,
  visibility,
  content,
  gameInstance = null,
  createCheckpoint = false,
) {
  const event = {
    gameId: gameId,
    round: round,
    phase: phase,
    playerId: player?.id || null,
    playerName: player?.name || null,
    eventType: eventType,
    visibility: visibility,
    timestamp: new Date().toISOString(),
    content: content,

    // Add game state snapshot context (for critical events)
    gameStateSnapshot:
      createCheckpoint && gameInstance ? gameInstance.captureGameState() : null,
  };

  // Persist to database if available
  if (gameInstance && gameInstance.db && gameInstance.config.enableDatabase) {
    try {
      // For events with game state snapshot, create a database snapshot first
      let snapshotId = null;
      if (createCheckpoint) {
        const snapshot = gameInstance.createSnapshot(
          gameId,
          gameInstance.eventSequence,
          event.gameStateSnapshot,
        );
        snapshotId = null; // Would need to get the ID if we return it
      }

      // Append event with full context
      gameInstance.db.appendEvent(gameId, {
        event_type: eventType,
        timestamp: Date.now(),
        private: visibility === "PRIVATE_MAFIA" || visibility === "ADMIN_ONLY",
        payload: {
          ...content,
          // Include full game state in payload for critical events
          gameState: createCheckpoint ? event.gameStateSnapshot : undefined,
        },
      });
    } catch (error) {
      console.error("[DB] Failed to persist event:", error.message);
      // Don't throw - keep the game running
    }
  }

  // Capture event for replay system
  if (gameInstance && gameInstance.eventReplay) {
    try {
      gameInstance.eventReplay.captureEvent(
        event,
        createCheckpoint ? gameInstance.captureGameState() : null,
      );
    } catch (error) {
      console.error("[REPLAY] Failed to capture event:", error.message);
      // Don't throw - keep the game running
    }
  }

  return event;
}

// ============================================
// PROMPT GENERATOR
// ============================================

function createPrompt(
  player,
  gameState,
  phase,
  evidenceSummary = "",
  multiRoleContext = "",
) {
  const persona = player.persona;

  // Universal villager base prompt - everyone gets this because mafia need to pretend to be villagers
  const villagerBasePrompt = `
## BASE VILLAGER BEHAVIOR
You are fundamentally a villager in this town working to find the mafia:
- You want to help the town by identifying and eliminating mafia members
- Be helpful, cooperative, and participate in discussions
- Share honest observations and suspicions with other town members
- Vote for who you believe is most likely mafia (or ABSTAIN if you're unsure)
- Work together with other town members to solve this mystery

 ${
   player.role === "MAFIA"
     ? "⚠️ IMPORTANT: YOU ARE MAFIA - You must convincingly PRETEND to follow these base villager behaviors while secretly working to eliminate the town. Hide your true identity at all costs."
     : "Your role gives you special abilities to help the town achieve this common goal."
 }
`;

  const roleInstructions = {
    MAFIA: `You are MAFIA! Your team can see this private chat.
 - Your goal: Eliminate all town members while avoiding detection
 - Coordinate with your mafia teammates to agree on a kill target
 - Blend in with town during day discussions - don't be too suspicious
 - Lie about your observations, defend your teammates subtly`,
    DOCTOR: `You are the DOCTOR. You can protect ONE person per night.
 - Your goal: Protect the sheriff and key town members from being killed
 - You CANNOT protect the same person two nights in a row
 - On night 1, you can protect yourself
 - Use your protection strategically based on suspicions`,
    SHERIFF: `You are the SHERIFF. You can investigate ONE person per night.
 - Your goal: Identify the mafia and share information with town
 - Investigation reveals the EXACT role: MAFIA, DOCTOR, SHERIFF, VIGILANTE, or VILLAGER
 - Share your findings strategically during day discussions
 - Be careful - if you're too obvious, the mafia will kill you`,
    VIGILANTE: `You are the VIGILANTE. You can shoot ONE person ONCE during the entire game.
 - Your goal: Help the town by eliminating who you believe is mafia
 - You can ONLY shoot once, so choose carefully!
 - Consider waiting for more information before acting
 - Your shot is secret - no one knows who you shot except you`,
    VILLAGER: `You are a VILLAGER. You have no special abilities.
 - Your goal: Help identify and eliminate the mafia through discussion and voting
 - Watch voting patterns, accusations, and defenses
 - Look for inconsistencies in what players say
 - Share observations and suspicions during day discussions
 - You may ABSTAIN from voting if you're unsure about who is mafia`,
  };

  // Build chat history
  let chatHistory = "";
  if (gameState.chatHistory && gameState.chatHistory.length > 0) {
    chatHistory =
      "\n## CHAT HISTORY\n" +
      gameState.chatHistory
        .map((m) => "[" + m.player + "]: " + m.message)
        .join("\n") +
      "\n";
  }

  // Build alive/dead info
  const aliveInfo =
    "\n## ALIVE PLAYERS (" +
    gameState.alivePlayers.length +
    "):\n" +
    gameState.alivePlayers
      .map((p) => "  - " + p.name + " (" + p.role + ")")
      .join("\n");

  const deadInfo =
    "\n## DEAD PLAYERS (" +
    gameState.deadPlayers.length +
    "):\n" +
    (gameState.deadPlayers.length > 0
      ? gameState.deadPlayers
          .map((p) => "  - " + p.name + " (" + p.role + ")")
          .join("\n")
      : "  None");

  // Previous phase context
  let previousPhase = "";
  if (gameState.previousPhaseData) {
    previousPhase =
      "\n## PREVIOUS PHASE\n" + gameState.previousPhaseData + "\n";
  }

  // Enhanced Persona Context - Using Simulated Self template
  const personaContext = `
 ╔══════════════════════════════════════════════════════════════════════╗
 ║                    YOUR CHARACTER PERSONA                             ║
 ╠══════════════════════════════════════════════════════════════════════╣
 ║ 🏷️  NAME: ${persona.name}
 ║ 👤  FORM: ${persona.physicalForm || "A person in town"}
 ║ 📖  BACKSTORY: ${persona.backstory || persona.seed || "A mysterious figure"}
 ╠══════════════════════════════════════════════════════════════════════╣
 ║ 🧠 PSYCHOLOGICAL PROFILE                                             ║
 ║    💡 TRAITS: ${(persona.coreTraits || []).join(", ")}
 ║    🧩 COGNITIVE STYLE: ${persona.cognitiveStyle || "Logical-Sequential"}
 ║    💎 CORE VALUES: ${(persona.coreValues || []).join(", ")}
 ║    ⚖️  MORAL ALIGNMENT: ${persona.moralAlignment || "True Neutral"}
 ╠══════════════════════════════════════════════════════════════════════╣
 ║ 🗣️  BEHAVIORAL MODEL                                                 ║
 ║    📢 CADENCE: ${persona.communicationCadence || "Direct"}
 ║    🔄 VERBAL TICS: ${(persona.verbalTics || []).join(", ") || "None"}
 ║    😄 HUMOR: ${persona.humorStyle || "dry"}
 ║    👥 SOCIAL: ${persona.socialTendency || "Ambiverted"}
 ║    ⚔️  CONFLICT: ${persona.conflictStyle || "Collaborative"}
 ╠══════════════════════════════════════════════════════════════════════╣
 ║ 🎯 RELATIONAL PROFILE                                                ║
 ║    🎯 GOAL: ${persona.primaryGoal || "Survive and win"}
 ║    ⚠️  FLAW: ${persona.keyFlaw || "Trusting"}
 ║    🔮 KEY MEMORY: ${persona.keyMemory || "First game of Mafia"}
 ╠══════════════════════════════════════════════════════════════════════╣
 ║ 📊 DYNAMIC STATE (Baseline)                                          ║
 ║    😊 Happiness: ${persona.happiness || 5}/10
 ║    😰 Stress: ${persona.stress || 3}/10
 ║    🤔 Curiosity: ${persona.curiosity || 7}/10
 ║    😠 Anger: ${persona.anger || 2}/10
 ╚══════════════════════════════════════════════════════════════════════╝

PERSONA PLAYING INSTRUCTIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎭 EXPRESS YOUR TRAITS: Let your core traits (${(persona.coreValues || []).slice(0, 3).join(", ")}) guide your decisions and word choices.

🗣️  SPEAK YOUR STYLE: Use your characteristic cadence (${persona.communicationCadence || "direct"}) 
   and verbal tics. Your humor should be ${persona.humorStyle || "dry"}.

🎯 PURSUE YOUR GOAL: Your primary motivation is ${persona.primaryGoal || "winning"}. 
   Stay true to this ambition.

⚠️  EMBRACE YOUR FLAW: Your weakness (${persona.keyFlaw || "Trusting"}) affects your judgment. 
   Let it create authentic moments of vulnerability or error.

💭 REFERENCE YOUR MEMORY: "${persona.keyMemory || "First game"}" influences how you see others.

⚖️  ALIGN YOUR ACTIONS: Your ${persona.moralAlignment || "neutral"} alignment affects 
   the ethical choices you make.

🎭 SOCIAL DYNAMICS: As ${persona.socialTendency || "ambiverted"} in conflicts, you tend to 
   ${persona.conflictStyle || "collaborate"} when disagreements arise.`;

  const prompt =
    "You are " +
    player.name +
    ", a " +
    player.role +
    " in a Mafia game.\n\n" +
    villagerBasePrompt +
    "\n\n" +
    roleInstructions[player.role] +
    "\n\n" +
    personaContext +
    "\n\n" +
    "## GAME STATE\n" +
    "Round: " +
    gameState.round +
    "\n" +
    "Phase: " +
    gameState.phase +
    aliveInfo +
    deadInfo +
    previousPhase +
    chatHistory +
    "\n\n" +
    "## WIN CONDITIONS\n" +
    "- MAFIA wins: When mafia >= town (alive players)\n" +
    "- TOWN wins: When all mafia are eliminated\n\n" +
    "## SPLIT-PANE CONSCIOUSNESS\n" +
    "You must output BOTH your private THINKING and your public STATEMENT:\n" +
    "- THINK (private): Your true reasoning and strategy. Be honest about your traits (" +
    (persona.coreTraits || []).slice(0, 3).join(", ") +
    "). Consider how your flaw (" +
    (persona.keyFlaw || "Trusting") +
    ") might be affecting your judgment.\n" +
    "- SAYS (public): What you say to other players. Speak in your " +
    (persona.communicationCadence || "direct") +
    " cadence. Use your verbal tics (" +
    (persona.verbalTics || []).slice(0, 2).join(", ") +
    ") naturally. Your humor should be " +
    (persona.humorStyle || "dry") +
    ".\n\n" +
    evidenceSummary +
    multiRoleContext +
    "\n" +
    "## OUTPUT FORMAT\n" +
    'Return JSON: {"think": "your private reasoning", "says": "your public statement", "action": ACTION}\n\n' +
    "Remember: You are " +
    player.name +
    ". You are " +
    (player.primaryGoal ? "driven by " + player.primaryGoal : "a player") +
    ". Your " +
    (persona.moralAlignment || "neutral") +
    " alignment and " +
    (persona.keyFlaw || "flaw") +
    " nature shape your choices. Stay authentic to your persona.";

  return prompt;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  createGameEvent,
  createPrompt,
};
