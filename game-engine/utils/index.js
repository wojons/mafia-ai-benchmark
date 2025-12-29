// ============================================
// UTILITIES MODULE
// ============================================

const E = {
  GAME: "🎮",
  NIGHT: "🌙",
  DAY: "☀️",
  LOCK: "🔒",
  THINK: "🔒",
  SAYS: "📢",
  MAFIA: "😈",
  DOCTOR: "💉",
  SHERIFF: "👮",
  VIGILANTE: "🔫",
  VILLAGER: "👱",
  SHOOT: "🔫",
  KILL: "💀",
  PROTECT: "🛡️",
  SLEEP: "😴",
  NEWSPAPER: "📰",
  VOTE: "🗳️",
  WIN: "🏆",
  TOWN: "🎉",
  MAFIAWIN: "😈",
  CONTINUE: "⏭️",
  LYNCH: "🚨",
  TIE: "⏭️",
  MAFIATEAM: "[MAFIA TEAM]",
  PUB: "🌍",
  PRIV: "🔒",
};

const roleEmojis = {
  MAFIA: E.MAFIA,
  DOCTOR: E.DOCTOR,
  SHERIFF: E.SHERIFF,
  VIGILANTE: E.VIGILANTE,
  VILLAGER: E.VILLAGER,
};

// Only print banner when executed directly
if (require.main === module) {
  console.log(E.GAME + " Mafia AI Benchmark - PERSONA EDITION v5");
  console.log("=".repeat(70));
  console.log(
    "Features: Persona System, Mafia Consensus, Roles, Voting, Database",
  );
  console.log("=".repeat(70) + "\n");
}

// ============================================
// UUID GENERATOR
// ============================================

function simpleUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? (r & 0x3) | 0x8 : (r & 0xc) | 0x4;
    return v.toString(16);
  });
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  E,
  roleEmojis,
  simpleUUID,
};
