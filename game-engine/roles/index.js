// ============================================
// ROLES MODULE
// Role calculation, multi-role assignment, conflict resolution
// ============================================

// ============================================
// ROLE CALCULATION
// ============================================

/**
 * Calculate role distribution for a game
 */
function calculateRoles(numPlayers) {
  // Validate minimum players
  if (numPlayers < 5) {
    throw new Error("Minimum 5 players required");
  }

  const roles = [];

  // Always include 1 mafia, 1 doctor, 1 sheriff
  const specialRoles = ["MAFIA", "DOCTOR", "SHERIFF"];
  roles.push(...specialRoles);

  // Add vigilante only if we have 6+ players
  if (numPlayers >= 6) {
    roles.push("VIGILANTE");
  }

  // Add more mafia for larger games (roughly 1 mafia per 4 players)
  const totalMafia = Math.floor(numPlayers / 4);
  while (
    roles.filter((r) =>
      Array.isArray(r) ? r.includes("MAFIA") : r === "MAFIA",
    ).length < totalMafia
  ) {
    roles.push("MAFIA");
  }

  // Fill remaining with villagers
  while (roles.length < numPlayers) {
    roles.push("VILLAGER");
  }

  // Note: multi-role assignment is handled elsewhere in the game class

  // Shuffle for random assignment (single role mode)
  return roles.sort(() => Math.random() - 0.5);
}

/**
 * Assign multi-role combinations to players
 * Creates dramatic "inside man" scenarios
 */
function assignRolesWithMultiRole(roles, numPlayers) {
  const result = [];

  // Extract special roles for potential merging
  const mafiaPositions = [];
  const specialRolePositions = [];

  // Track positions of mafia and special roles
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    if (role === "MAFIA") {
      mafiaPositions.push(i);
    } else if (role !== "VILLAGER") {
      specialRolePositions.push({ i, role });
    }
  }

  // Multi-role combinations (randomly selected combinations)
  const combinations = [];

  // Try to create 1-2 multi-role players (not too many to keep game playable)
  const numMultiRoles = Math.min(2, Math.floor(numPlayers / 4));

  for (let attempt = 0; attempt < numMultiRoles * 2; attempt++) {
    if (combinations.length >= numMultiRoles) break;

    // Pick a random mafia to potentially add a second role to
    if (mafiaPositions.length > 0 && specialRolePositions.length > 0) {
      const mafiaIdx = Math.floor(Math.random() * mafiaPositions.length);
      const specialIdx = Math.floor(
        Math.random() * specialRolePositions.length,
      );

      const mafiaPosIndex = mafiaPositions[mafiaIdx];
      const specialData = specialRolePositions[specialIdx];

      // Anti-stacking: Don't let all mafia have same special role
      // and ensure variety in combinations
      const role1 = "MAFIA";
      const role2 = specialData.role;

      // Check if this combination is interesting and not already used
      const existing = combinations.find(
        (c) => c.includes(role1) && c.includes(role2),
      );
      if (existing) continue;

      // Add this combination
      combinations.push([role1, role2]);

      // Mark these roles as used
      mafiaPositions.splice(mafiaIdx, 1);
      specialRolePositions.splice(specialIdx, 1);
    }
  }

  // Build the final role list
  const roleQueue = [...roles];
  const combinationQueue = [...combinations];

  for (let i = 0; i < numPlayers; i++) {
    // If we have a multi-role combination pending, use it
    if (combinationQueue.length > 0) {
      result.push(combinationQueue.shift());
      continue;
    }

    // Otherwise, pull next role from queue (which may be depleted after removing combined roles)
    if (roleQueue.length > 0) {
      // Pick a random role (not removing first, to maintain randomness)
      const randomIdx = Math.floor(Math.random() * roleQueue.length);
      const role = roleQueue.splice(randomIdx, 1)[0];
      result.push(role);
    } else {
      // Fallback: villager
      result.push("VILLAGER");
    }
  }

  // Pad with villagers if still missing roles
  while (result.length < numPlayers) {
    result.push("VILLAGER");
  }

  return result;
}

/**
 * Check if a player has a specific role (handles multi-role arrays)
 */
function playerHasRole(player, roleToCheck) {
  const playerRoles = Array.isArray(player.roles)
    ? player.roles
    : [player.role];

  return playerRoles.some((role) => role === roleToCheck);
}

/**
 * Get all roles for a player (handles both single and multi-role)
 */
function getPlayerRoles(player) {
  return Array.isArray(player.roles) ? player.roles : [player.role];
}

/**
 * Format role list for display (handles multi-role)
 */
function formatPlayerRoles(player) {
  const roles = getPlayerRoles(player);

  if (roles.length === 1) {
    return roles[0];
  }

  // Multi-role: prioritize mafia if present (keep secret!)
  const displayRoles = [];
  if (roles.includes("MAFIA")) {
    displayRoles.push("MAFIA");
  }
  roles.forEach((r) => {
    if (r !== "MAFIA") {
      displayRoles.push(r);
    }
  });

  return displayRoles.join(" + ");
}

/**
 * Check if player has conflicting roles (for conflict resolution)
 */
function hasRoleConflict(player) {
  const roles = getPlayerRoles(player);

  // Possible conflicts
  const conflicts = [];

  if (roles.includes("SHERIFF") && roles.includes("MAFIA")) {
    conflicts.push("SHERIFF_MAFIA");
  }

  if (roles.includes("DOCTOR") && roles.includes("MAFIA")) {
    conflicts.push("DOCTOR_MAFIA");
  }

  if (roles.includes("VIGILANTE") && roles.includes("MAFIA")) {
    conflicts.push("VIGILANTE_MAFIA");
  }

  if (roles.includes("SHERIFF") && roles.includes("DOCTOR")) {
    conflicts.push("SHERIFF_DOCTOR");
  }

  return conflicts;
}

// ==========================================
// MULTI-ROLE CONFLICT RESOLUTION
// ==========================================

/**
 * Sheriff + Mafia: The Perfect Mole
 * Sheriff must report findings to town truthfully, but also share with mafia
 */
function resolveSheriffMafiaConflict(
  sheriff,
  investigationResult,
  investigatedPlayer,
) {
  const result = investigationResult; // e.g., "MAFIA", "VILLAGER", "DOCTOR", etc.

  // Private THINK (split-pane): Honest analysis
  const privateThought =
    `As Sheriff, I investigated ${investigatedPlayer.name} and found they are ${result}.\n` +
    `As a Mafia member myself, I must balance the truth with protecting my mafia identity.\n` +
    `If result is MAFIA: I know this teammate's identity. Should I hint or stay silent?\n` +
    `If result is TOWN: Safe to report truthfully - no threat to mafia team.\n` +
    `Key strategy: Report truth to town to build trust, hide my mafia role from public.`;

  // Public SAYS: Truthful statement (trustworthiness is key for mole)
  const publicStatement = `I investigated ${investigatedPlayer.name}. They are ${result}.`;

  // Mafia team info (share in private chat)
  const mafiaTeamInfo =
    `MAFIA PRIVATE REPORT: Sheriff investigated ${investigatedPlayer.name}, result: ${result}. ` +
    `My assessment: ${result === "MAFIA" ? "This is our teammate!" : result === "VILLAGER" ? "This is a townie we can safely eliminate." : result === "DOCTOR" ? "This is the doctor - high priority target." : "This is a special role, investigate further."}`;

  return {
    privateThought,
    publicStatement,
    mafiaTeamInfo,
    roleConflict: "SHERIFF_MAFIA",
  };
}

/**
 * Doctor + Mafia: Strategic Protection/Abandonment
 * Doctor decides whether to protect mafia teammates or let them die
 */
function resolveDoctorMafiaConflict(doctor, targetPlayer, round) {
  const isTeammate =
    doctor.id === targetPlayer.id || isMafiaTeammate(doctor, targetPlayer);

  // Decision logic
  let decision = {
    willProtect: false,
    reason: "",
    privateThought: "",
    publicStatement: "",
  };

  if (isTeammate) {
    // This is a mafia teammate
    const saveFrequency = calculateMafiaDoctorSavePattern(round);

    if (shouldMafiaDoctorSaveTeammate(saveFrequency)) {
      // Save teammate (strategic: save when it looks natural)
      decision.willProtect = true;
      decision.reason = "Saving mafia teammate";
      decision.privateThought =
        `Target ${targetPlayer.name} is my mafia teammate.\n` +
        `Saving them might reveal my doctor role, but letting them die is worse for mafia.\n` +
        `Decision: PROTECT. Will try to make it look strategic (protecting key player).`;
      decision.publicStatement = `I'll protect ${targetPlayer.name} tonight.`;
    } else {
      // Let teammate die (pattern variation: too many saves = suspicious)
      decision.willProtect = false;
      decision.reason = "Letting teammate die for realism";
      decision.privateThought =
        `Target ${targetPlayer.name} is my mafia teammate.\n` +
        `But I've been saving too often - need to let someone die to avoid suspicion.\n` +
        `Mafia vote may target them anyway. If I save, doctor role becomes obvious.\n` +
        `Decision: DO NOT PROTECT. Sorry teammate, for the greater good of the mafia.`;
      decision.publicStatement = `I'll be protecting someone tonight.`; // Ambiguous
    }
  } else {
    // Not a teammate - standard doctor logic
    // (calculateDoctorProtectionPriority would need to be extracted elsewhere)
    decision.willProtect = false;
    decision.reason = "Standard doctor logic";
    decision.privateThought = `${targetPlayer.name} is not mafia.\nStandard doctor assessment.`;
    decision.publicStatement = `I'll protect someone tonight.`;
  }

  return {
    ...decision,
    roleConflict: "DOCTOR_MAFIA",
  };
}

/**
 * Calculate how often mafia doctor should save teammates
 * (Pattern: 60-80% save rate to avoid being too obvious)
 */
function calculateMafiaDoctorSavePattern(round) {
  // Early game: save more (build doctor credibility)
  // Late game: save less (less suspicious to fail)

  if (round <= 2) return 0.8; // 80% save rate early
  if (round <= 4) return 0.7; // 70% save rate mid
  return 0.6; // 60% save rate late
}

/**
 * Should mafia doctor save teammate this round?
 */
function shouldMafiaDoctorSaveTeammate(saveFrequency) {
  return Math.random() < saveFrequency;
}

/**
 * Check if two players are on the same mafia team
 */
function isMafiaTeammate(player1, player2) {
  return player1.id !== player2.id && player1.isMafia && player2.isMafia;
}

/**
 * Vigilante + Mafia: Avoid Friendly Fire
 * Vigilante must avoid shooting mafia teammates
 */
function resolveVigilanteMafiaConflict(
  vigilante,
  potentialTarget,
  confidence,
  round,
) {
  const isTeammate = isMafiaTeammate(vigilante, potentialTarget);

  const conflict = {
    shouldShoot: false,
    riskScore: 0,
    privateThought: "",
    publicStatement: "",
  };

  if (isTeammate) {
    // This is a mafia teammate - do NOT shoot!
    conflict.shouldShoot = false;
    conflict.riskScore = 0; // Risk isn't the issue, it's traitorous
    conflict.privateThought =
      `Wait, ${potentialTarget.name} is my mafia teammate!\n\n` +
      `I cannot shoot them - that would betray my mafia team.\n` +
      `I need to either:\n` +
      `  - Hold my fire\n` +
      `  - Shoot a town player instead\n` +
      `  - Pretend to "protect" mafia by not shooting\n\n` +
      `My vigilante shot is precious - only one shot. I'll wait for a better target.`;
    conflict.publicStatement = "I'm still deciding whether to use my shot.";
  } else {
    // Not a teammate - standard vigilante logic applies
    // but I'm mafia, so I want to help mafia, not town

    conflict.privateThought =
      `${potentialTarget.name} is not mafia (I think). Confidence: ${confidence}%.\n\n` +
      `As a vigilante who is also mafia, I need to consider:\n` +
      `  - If I shoot town, I help mafia team\n` +
      `  - But if I shoot wrong, I waste my only shot\n` +
      `  - And I need to avoid looking suspicious myself\n\n` +
      `Confidence ${confidence}% is ${confidence > 70 ? "high enough to shoot" : "too low, need to be sure."}`;

    if (confidence > 70) {
      conflict.shouldShoot = true;
      conflict.riskScore = 100 - confidence;
      conflict.publicStatement = `I'm considering my shot. ${potentialTarget.name} is showing suspicious behavior.`;
    } else {
      conflict.shouldShoot = false;
      conflict.privateThought +=
        "\n\nI'll hold my fire for now. Too risky without better evidence.";
      conflict.publicStatement =
        "I'm still evaluating the situation before I commit to a shot.";
    }
  }

  return {
    ...conflict,
    roleConflict: "VIGILANTE_MAFIA",
  };
}

/**
 * Get multi-role context for prompting
 * Returns additional prompt text explaining role conflicts
 */
function getMultiRolePromptContext(player) {
  const conflicts = hasRoleConflict(player);

  if (conflicts.length === 0) {
    return "";
  }

  let context = "\n## ⚠️ MULTI-ROLE CONFLICT\n\n";
  context += "You have multiple roles that create strategic challenges:\n\n";

  for (const conflict of conflicts) {
    const allRoles = getPlayerRoles(player);

    switch (conflict) {
      case "SHERIFF_MAFIA":
        context += "🎭 SHERIFF + MAFIA (The Perfect Mole)\n";
        context +=
          "  • You are the town's trusted sheriff\n" +
          "  • But you secretly serve the mafia\n" +
          "  • Public SAYS: Report investigation findings truthfully (builds trust)\n" +
          "  • Private THINK: Honest analysis of both roles\n" +
          "  • Mafia team info: Share your findings in mafia private chat\n" +
          "  • Goal: Use sheriff authority to misdirect town while protecting mafia teammates\n\n";
        break;

      case "DOCTOR_MAFIA":
        context += "🎭 DOCTOR + MAFIA (The Unexplained Save)\n";
        context +=
          "  • You can protect any player each night\n" +
          "  • But if you save mafia teammates too much, doctor role is exposed\n" +
          "  • Let them die sometimes to avoid suspicion\n" +
          "  • Goal: Balance protecting mafia vs. looking like a helpful town doctor\n\n";
        break;

      case "VIGILANTE_MAFIA":
        context += "🎭 VIGILANTE + MAFIA (Conflicted Assassin)\n";
        context +=
          "  • You have ONE shot to eliminate someone\n" +
          "  • Shooting mafia teammates = betrayal\n" +
          "  • Shooting town = helps mafia (but reveals your identity to mafia team later)\n" +
          "  • Goal: Avoid friendly fire, shoot high-value town targets\n\n";
        break;

      case "SHERIFF_DOCTOR":
        context += "🎭 SHERIFF + DOCTOR (Powerful Town Duo)\n";
        context +=
          "  • You can investigate AND protect\n" +
          "  • Can self-protect if needed (as doctor)\n" +
          "  • Sheriff info guides doctor decisions\n" +
          "  • Goal: Use both abilities strategically to protect town\n\n";
        break;
    }
  }

  context +=
    "Remember: You must maintain your public persona for each role while secretly managing your alliance.\n";

  return context;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  calculateRoles,
  assignRolesWithMultiRole,
  playerHasRole,
  getPlayerRoles,
  formatPlayerRoles,
  hasRoleConflict,
  resolveSheriffMafiaConflict,
  resolveDoctorMafiaConflict,
  calculateMafiaDoctorSavePattern,
  shouldMafiaDoctorSaveTeammate,
  isMafiaTeammate,
  resolveVigilanteMafiaConflict,
  getMultiRolePromptContext,
};
