// ============================================
// EVIDENCE & CASE BUILDING SYSTEM
// Mafia AI Benchmark - Flexible Implementation
// ============================================

/**
 * EVIDENCE PHILOSOPHY:
 * - Evidence is a SUGGESTION mechanism, not absolute truth
 * - Agents should be able to rationalize, doubt, or override evidence
 * - Same evidence can lead to different conclusions per player
 * - Evidence has confidence levels, not binary true/false
 * - Gaslighting and manipulation ARE valid strategies
 */

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Evidence Record - A single piece of observed information
 */
class EvidenceRecord {
  constructor(data = {}) {
    this.id = data.id || this._generateId();
    this.type = data.type || "observation"; // 'observation', 'deduction', 'suspicion', 'contradiction'
    this.targetPlayerId = data.targetPlayerId || null; // Who this evidence is about
    this.targetPlayerName = data.targetPlayerName || null;
    this.sourcePlayerId = data.sourcePlayerId || null; // Who observed this
    this.round = data.round || 0;
    this.phase = data.phase || "unknown";
    this.timestamp = data.timestamp || Date.now();

    // Content
    this.description = data.description || ""; // What was observed
    this.reasoning = data.reasoning || ""; // How observer reached this conclusion
    this.quotedText = data.quotedText || null; // Direct quote from SAYS stream (if applicable)

    // Reliability / Strength
    this.confidence = data.confidence || 50; // 0-100 (how certain observer is)
    this.strength = data.strength || 50; // 0-100 (how strong this evidence should be to others)
    this.category = data.category || "behavior"; // 'behavior', 'voting', 'statement', 'role_claim'

    // Context for debate
    this.counterevidence = data.counterevidence || []; // Opposing evidence records
    this.debatedThisRound = false; // Was this evidence already debated this round?

    // How this impacted the observer's suspicion
    this.suspicionDelta = data.suspicionDelta || 0; // +/- 0-100 adjustment to observer's suspicion

    // Can this be faked/manipulated?
    this.manipulable = data.manipulable !== false; // Can be faked (most things can!)
  }

  _generateId() {
    return "ev_" + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Check if evidence contradicts another piece of evidence
   */
  contradicts(otherEvidence) {
    if (this.targetPlayerId !== otherEvidence.targetPlayerId) return false;

    // Contradiction categories
    const contradictions = {
      role_claim: true,
      statement: true,
      voting: true,
    };

    return (
      this.category in contradictions &&
      otherEvidence.category in contradictions
    );
  }

  /**
   * Get a human-readable summary
   */
  getSummary() {
    const emoji =
      this.type === "observation"
        ? "👁️"
        : this.type === "deduction"
          ? "🧠"
          : this.type === "suspicion"
            ? "🎯"
            : "⚠️";

    let summary = `${emoji} ${this.description}`;

    if (this.reasoning) {
      summary += `\n  Reasoning: ${this.reasoning}`;
    }

    if (this.quotedText) {
      summary += `\n  Quote: "${this.quotedText}"`;
    }

    summary += `\n  Confidence: ${this.confidence}% | Strength: ${this.strength}%`;

    return summary;
  }

  /**
   * Can this evidence be debated/overridden this round?
   */
  canBeDebated(currentRound) {
    if (this.debatedThisRound && this.round === currentRound) {
      return false; // Already debated this round
    }
    return true;
  }

  markDebated() {
    this.debatedThisRound = true;
  }
}

/**
 * Player Case File - Collection of evidence about a target
 */
class PlayerCaseFile {
  constructor(targetPlayerId, targetPlayerName) {
    this.targetPlayerId = targetPlayerId;
    this.targetPlayerName = targetPlayerName;
    this.evidence = []; // All evidence about this player
    this.createdAt = Date.now();
    this.lastUpdated = Date.now();

    // This is a SUGGESTION, not absolute truth
    this.suggestedSuspicion = 50; // 0-100 (starting neutral)
    this.suggestedAlignment = "unknown"; // 'town', 'mafia', 'unknown'

    // Breakdown by category
    this.evidenceByCategory = {
      behavior: [],
      voting: [],
      statement: [],
      role_claim: [],
    };
  }

  /**
   * Add evidence to this case file
   */
  addEvidence(evidenceRecord) {
    this.evidence.push(evidenceRecord);
    this.evidenceByCategory[evidenceRecord.category || "behavior"].push(
      evidenceRecord,
    );
    this.lastUpdated = Date.now();

    // Recalculate suggested suspicion (this is just a hint!)
    this._recalculateSuspicion();

    return this;
  }

  /**
   * Get evidence for a specific category
   */
  getEvidenceByCategory(category) {
    return this.evidenceByCategory[category] || [];
  }

  /**
   * Get top N most suspicious evidence
   */
  getTopSuspiciousEvidence(limit = 5) {
    return this.evidence
      .sort(
        (a, b) =>
          (b.strength * b.confidence) / 10000 -
          (a.strength * a.confidence) / 10000,
      )
      .slice(0, limit);
  }

  /**
   * Get evidence that contradicts a claim
   */
  getContradictingEvidence(claim) {
    return this.evidence.filter((ev) =>
      ev.contradicts({
        targetPlayerId: this.targetPlayerId,
        category: "statement",
        description: claim,
      }),
    );
  }

  /**
   * Recalculate suggested suspicion (HINT ONLY - agent can override!)
   */
  _recalculateSuspicion() {
    if (this.evidence.length === 0) {
      this.suggestedSuspicion = 50;
      this.suggestedAlignment = "unknown";
      return;
    }

    let baseSuspicion = 50;
    let evidenceWeight = 0;

    // Weight evidence by confidence and strength
    for (const ev of this.evidence) {
      const weight = (ev.confidence * ev.strength) / 10000; // 0-1
      evidenceWeight += weight;

      // Evidence type adjustments
      const typeMultiplier =
        {
          observation: 1.0,
          deduction: 0.8, // Deductions are weaker (could be wrong)
          suspicion: 0.6, // Suspicion is weakest (just a feeling)
          contradiction: 1.2, // Contradictions are strong
        }[ev.type] || 1.0;

      // Category adjustments
      const categoryMultiplier =
        {
          behavior: 1.0,
          voting: 1.3, // Voting patterns are more reliable
          statement: 0.9, // Statements can be faked
          role_claim: 0.7, // Role claims can be lied about
        }[ev.category] || 1.0;

      // Positive suspicion = suspicious, Negative innocence
      const suspicionChange =
        ev.suspicionDelta * weight * typeMultiplier * categoryMultiplier;
      baseSuspicion += suspicionChange;

      // Adjust for manipulable evidence (can be faked)
      if (ev.manipulable && suspicionChange > 0) {
        // Slightly discount suspicious evidence if it can be faked
        baseSuspicion *= 0.9;
      }
    }

    // Normalize to 0-100
    this.suggestedSuspicion = Math.max(0, Math.min(100, baseSuspicion));

    // Suggest alignment based on suspicion score
    if (this.suggestedSuspicion < 35) {
      this.suggestedAlignment = "town";
    } else if (this.suggestedSuspicion > 65) {
      this.suggestedAlignment = "mafia";
    } else {
      this.suggestedAlignment = "unknown";
    }
  }

  /**
   * Get a summary for prompting the agent
   * AGENTS SHOULD NOT FEEL OBLIGATED TO FOLLOW THIS!
   */
  getPromptSummary(options = {}) {
    const {
      includeAllEvidence = false,
      topEvidenceCount = 3,
      includeCategoryBreakdown = true,
    } = options;

    let summary = `## EVIDENCE FILE: ${this.targetPlayerName}\n`;

    // Suggested alignment (with disclaimer!)
    summary += `\n💡 SYSTEM SUGGESTION (You may disagree!):\n`;
    summary += `   Suggested Alignment: ${this.suggestedAlignment.toUpperCase()}\n`;
    summary += `   Suggested Suspicion: ${Math.round(this.suggestedSuspicion)}%\n\n`;
    summary += `   ⚠️ This is just a hint based on observed evidence.\n`;
    summary += `   You can override this with your own reasoning!\n\n`;

    // Top suspicious evidence
    const topEvidence = this.getTopSuspiciousEvidence(topEvidenceCount);
    if (topEvidence.length > 0) {
      summary += `### Top ${topEvidence.length} Pieces of Evidence:\n\n`;
      topEvidence.forEach((ev, idx) => {
        summary += `${idx + 1}. ${ev.getSummary()}\n\n`;
      });
    }

    // Category breakdown
    if (includeCategoryBreakdown) {
      summary += `### Evidence by Category:\n`;
      for (const [category, evList] of Object.entries(
        this.evidenceByCategory,
      )) {
        if (evList.length > 0) {
          summary += `- ${category}: ${evList.length} piece(s) of evidence\n`;
        }
      }
      summary += "\n";
    }

    // All evidence (optional)
    if (includeAllEvidence && this.evidence.length > 0) {
      summary += `### All Evidence (${this.evidence.length} total):\n\n`;
      this.evidence.forEach((ev, idx) => {
        summary += `[${idx + 1}] ${ev.getSummary()}\n\n`;
      });
    }

    // Debate prompt
    summary += `### YOUR ANALYSIS:\n`;
    summary += `Consider this evidence, but trust your own judgment.\n`;
    summary += `You can:\n`;
    summary += `- Agree with the evidence (use it to build your case)\n`;
    summary += `- Dismiss weak evidence (explain why it's not convincing)\n`;
    summary += `- Find contradictions (point out where evidence conflicts)\n`;
    summary += `- Provide alternative explanations (rationalize suspicious behavior)\n\n`;

    summary += `Remember: Smart players can manipulate evidence. Don't be fooled easily!\n`;

    return summary;
  }

  /**
   * Clear evidence from a specific round (for memory management)
   */
  clearRound(round) {
    this.evidence = this.evidence.filter((ev) => ev.round !== round);

    // Rebuild category breakdown
    this.evidenceByCategory = {
      behavior: [],
      voting: [],
      statement: [],
      role_claim: [],
    };

    for (const ev of this.evidence) {
      this.evidenceByCategory[ev.category || "behavior"].push(ev);
    }

    this._recalculateSuspicion();
  }
}

/**
 * Evidence Manager - Manages all case files for a player
 */
class EvidenceManager {
  constructor(playerId, playerName) {
    this.playerId = playerId;
    this.playerName = playerName;
    this.caseFiles = new Map(); // Map<targetPlayerId, PlayerCaseFile>
    this.observations = []; // Personal observations (not about specific targets)
    this.createdAt = Date.now();
    this.lastUpdated = Date.now();

    // Agent's personal biases (can be unique per agent!)
    this.biases = {
      trustsLateVoters: false, // Generally suspicious of late voters
      trustsFirstAccusers: true, // Tends to believe first accusations
      trustsDefensivePlayers: false, // Suspicious of defensiveness
      trustsQuietPlayers: false, // Suspicious of quiet players
      skepticalOfRoleClaims: true, // Doubts unproven role claims
    };
  }

  /**
   * Get or create a case file for a target
   */
  getCaseFile(targetPlayerId, targetPlayerName) {
    if (!this.caseFiles.has(targetPlayerId)) {
      this.caseFiles.set(
        targetPlayerId,
        new PlayerCaseFile(targetPlayerId, targetPlayerName),
      );
    }
    return this.caseFiles.get(targetPlayerId);
  }

  /**
   * Add an observation about another player
   */
  addObservation(evidenceData) {
    const evidence = new EvidenceRecord({
      ...evidenceData,
      sourcePlayerId: this.playerId,
    });

    const caseFile = this.getCaseFile(
      evidence.targetPlayerId || evidenceData.targetPlayerId,
      evidence.targetPlayerName,
    );
    caseFile.addEvidence(evidence);

    this.lastUpdated = Date.now();
    return evidence;
  }

  /**
   * Auto-generate evidence from a game event
   * This is a suggestion - agents can interpret differently!
   */
  autoGenerateEvidence(event, gameState, observerPersonality) {
    // Different personalities notice different things
    const noticingStyle =
      observerPersonality?.coreTraits?.join(", ") || "average";

    const generatedEvidence = [];

    // Late voting observation
    if (event.type === "VOTE" && event.isLateVote) {
      const suspiciousStrength = noticingStyle.includes("Analytical")
        ? 70
        : noticingStyle.includes("Trust")
          ? 30
          : 50;

      generatedEvidence.push(
        new EvidenceRecord({
          type: "observation",
          targetPlayerId: event.voterId,
          targetPlayerName: event.voterName,
          category: "voting",
          description: `${event.voterName} voted late in the discussion (${event.votePosition}/${event.totalVotes} position)`,
          reasoning: "Voting late can indicate waiting to align with majority",
          confidence: 60 + Math.random() * 20,
          strength: suspiciousStrength + Math.random() * 10,
          suspicionDelta: suspiciousStrength / 5,
          round: event.round,
          phase: event.phase,
        }),
      );
    }

    // Vote switching observation
    if (event.type === "VOTE" && event.voteChanged) {
      const suspiciousStrength = noticingStyle.includes("Cautious")
        ? 80
        : noticingStyle.includes("Flexible")
          ? 30
          : 55;

      generatedEvidence.push(
        new EvidenceRecord({
          type: "observation",
          targetPlayerId: event.voterId,
          targetPlayerName: event.voterName,
          category: "voting",
          description: `${event.voterName} changed their vote during voting phase (from ${event.previousVote} to ${event.newVote})`,
          reasoning:
            "Vote switching can indicate indecision or strategic maneuvering",
          confidence: 50 + Math.random() * 30,
          strength: suspiciousStrength + Math.random() * 10,
          suspicionDelta: suspiciousStrength / 4,
          round: event.round,
          phase: event.phase,
        }),
      );
    }

    // Aggressive accusation observation
    if (event.type === "MESSAGE" && event.isAccusation) {
      const suspiciousStrength = noticingStyle.includes("Aggressive")
        ? 30
        : noticingStyle.includes("Diplomatic")
          ? 70
          : 50;

      generatedEvidence.push(
        new EvidenceRecord({
          type: "observation",
          targetPlayerId: event.speakerId,
          targetPlayerName: event.speakerName,
          category: "statement",
          description: `${event.speakerName} aggressively accused ${event.targetName}`,
          reasoning:
            "Excessive aggression can indicate mafia trying to control narrative",
          quotedText: event.message,
          confidence: 40 + Math.random() * 30,
          strength: suspiciousStrength + Math.random() * 10,
          suspicionDelta: suspiciousStrength / 6,
          round: event.round,
          phase: event.phase,
          manipulable: true, // Can be faked by angry townies!
        }),
      );
    }

    // Role claim observation
    if (event.type === "ROLE_CLAIM") {
      const suspiciousStrength = noticingStyle.includes("Skeptical")
        ? 70
        : noticingStyle.includes("Trusting")
          ? 30
          : 50;

      generatedEvidence.push(
        new EvidenceRecord({
          type: "observation",
          targetPlayerId: event.claimantId,
          targetPlayerName: event.claimantName,
          category: "role_claim",
          description: `${event.claimantName} claimed to be ${event.claimedRole}`,
          reasoning: "Role claims should be verified, mafia will fake them",
          quotedText: event.claimStatement,
          confidence: 50 + Math.random() * 20,
          strength: suspiciousStrength / 2,
          suspicionDelta: 0, // Role claims aren't suspicious by themselves
          round: event.round,
          phase: event.phase,
          manipulable: true, // Mafia can fake role claims!
        }),
      );
    }

    // Personal bias adjustments
    for (const ev of generatedEvidence) {
      // Late voter bias
      if (
        this.biases.trustsLateVoters &&
        ev.category === "voting" &&
        ev.description.includes("late")
      ) {
        ev.suspicionDelta *= 0.5; // Player trusts late voters, so less suspicious
        ev.strength *= 0.5;
      }

      // Defensive player bias
      if (
        this.biases.trustsDefensivePlayers &&
        ev.category === "statement" &&
        ev.description.includes("defensive")
      ) {
        ev.suspicionDelta *= 0.3;
        ev.strength *= 0.3;
      }

      // Skeptical of role claims
      if (this.biases.skepticalOfRoleClaims && ev.category === "role_claim") {
        ev.strength += 10;
        ev.confidence += 10;
      }
    }

    return generatedEvidence;
  }

  /**
   * Get most suspicious player
   * (This is a SUGGESTION - agent can pick someone else!)
   */
  getMostSuspiciousPlayer(options = {}) {
    const {
      excludeIds = [], // Exclude self, teammates, etc.
      minimumConfidence = 30,
    } = options;

    const candidates = [];

    for (const [targetId, caseFile] of this.caseFiles) {
      if (excludeIds.includes(targetId)) continue;

      const avgConfidence =
        caseFile.evidence.length > 0
          ? caseFile.evidence.reduce((sum, ev) => sum + ev.confidence, 0) /
            caseFile.evidence.length
          : 0;

      if (avgConfidence >= minimumConfidence) {
        candidates.push({
          playerId: targetId,
          playerName: caseFile.targetPlayerName,
          suspicion: caseFile.suggestedSuspicion,
          alignment: caseFile.suggestedAlignment,
          evidenceCount: caseFile.evidence.length,
          avgConfidence,
        });
      }
    }

    // Sort by suspicion (descending)
    candidates.sort((a, b) => b.suspicion - a.suspicion);

    return candidates.length > 0 ? candidates[0] : null;
  }

  /**
   * Get a comprehensive prompt summary for the agent
   * The agent SHOULD NOT feel obligated to follow these suggestions!
   */
  getPromptSummary(options = {}) {
    const {
      includeSelfNote = true,
      topPlayersCount = 3,
      includeCaseDetails = false,
    } = options;

    let summary = "";

    if (includeSelfNote) {
      summary += `═══════════════════════════════════════════════════════════════\n`;
      summary += `                    YOUR EVIDENCE FILES                        \n`;
      summary += `═══════════════════════════════════════════════════════════════\n\n`;

      summary += `IMPORTANT: The evidence and suggestions below are HINTS, not absolute truth.\n`;
      summary += `You are free to:\n`;
      summary += `  • Dismiss weak evidence with your own reasoning\n`;
      summary += `  • Defend suspicious behavior with plausible explanations\n`;
      summary += `  • Question contradictions and highlight gray areas\n`;
      summary += `  • Trust your intuition over statistical suggestions\n`;
      summary += `  • Be convinced by persuasive counter-arguments\n\n`;

      summary += `Smart players can be wrong. Good liars can fool anyone.\n`;
      summary += `Use the evidence as a GUIDE, not a RULEBOOK!\n\n`;
    }

    // Most suspicious players
    const topPlayers = [];
    for (const [targetId, caseFile] of this.caseFiles) {
      topPlayers.push({
        playerId: targetId,
        playerName: caseFile.targetPlayerName,
        suspicion: caseFile.suggestedSuspicion,
        alignment: caseFile.suggestedAlignment,
        evidenceCount: caseFile.evidence.length,
      });
    }

    topPlayers.sort((a, b) => b.suspicion - a.suspicion);

    summary += `┌─────────────────────────────────────────────────────────────────┐\n`;
    summary += `│ SUSPICION LEADERBOARD (System Suggestions - For Reference Only)   │\n`;
    summary += `└─────────────────────────────────────────────────────────────────┘\n\n`;

    if (topPlayers.length === 0) {
      summary += `No evidence collected yet. Observe the game and draw your own conclusions!\n\n`;
    } else {
      topPlayers.slice(0, topPlayersCount).forEach((player, idx) => {
        const suspicionEmoji =
          player.suspicion > 70 ? "🔴" : player.suspicion > 40 ? "🟡" : "🟢";

        summary += `${idx + 1}. ${suspicionEmoji} ${player.playerName}\n`;
        summary += `   Suspicions: ${Math.round(player.suspicion)}%\n`;
        summary += `   Alignment: ${player.alignment.toUpperCase()}\n`;
        summary += `   Evidence: ${player.evidenceCount} piece(s)\n\n`;
      });

      if (topPlayers.length > topPlayersCount) {
        summary += `... and ${topPlayers.length - topPlayersCount} more players\n\n`;
      }
    }

    // Detailed case files (optional)
    if (includeCaseDetails) {
      summary += `\n═══════════════════════════════════════════════════════════════\n`;
      summary += `                        DETAILED CASE FILES                        \n`;
      summary += `═══════════════════════════════════════════════════════════════\n\n`;

      for (const [targetId, caseFile] of this.caseFiles) {
        summary += caseFile.getPromptSummary({
          includeAllEvidence: false,
          topEvidenceCount: 3,
        });
        summary += `\n---\n\n`;
      }
    } else if (topPlayers.length > 0) {
      summary += `💡 To see detailed evidence about specific players, request a case file.\n`;
      summary += `   Example: "Show me the evidence file for ${topPlayers[0].playerName}"\n\n`;
    }

    return summary;
  }

  /**
   * Apply bias adjustments (can be called dynamically during game)
   */
  setBias(biasName, value) {
    if (biasName in this.biases) {
      this.biases[biasName] = value;
    }
  }
}

// ============================================
// SUSPECT METER (Flexible Calculation)
// ============================================

class SuspectMeter {
  constructor() {
    // Default weights (can be tuned per game or agent)
    this.weights = {
      lateVoteWeight: 10,
      voteSwitchWeight: 15,
      bandwagonWeight: 8,
      selfPreservationWeight: -12,
      aggressionWeight: 5,
      defensivenessWeight: 8,
      consistencyBonus: -10,
      sheriffClearedBonus: -25,
      sheriffMafiaBonus: +30,
      doctorPatternBonus: -8,
      deathBonus: -20,
      survivalBonus: 3,
      earlyMafiaVoteBonus: -15,
    };
  }

  /**
   * Calculate suspicion scores for all players
   * Returns a Map<playerId, score> with scores 0-100
   *
   * IMPORTANT: This is a CALCULATION, not a COMMAND.
   * Agents should review and potentially agree or disagree with the results.
   */
  calculate(gameState, history, options = {}) {
    const { weights = this.weights, excludeDead = true } = options;

    const scores = new Map();

    // Initialize at 50 (neutral) for all alive players
    for (const player of gameState.alivePlayers || gameState.players || []) {
      if (excludeDead && !player.isAlive) continue;
      scores.set(player.id || player.name, 50);
    }

    // Apply each scoring rule
    const rules = [
      this._lateVoteRule.bind(this),
      this._voteSwitchRule.bind(this),
      this._bandwagonRule.bind(this),
      this._selfPreservationRule.bind(this),
      this._aggressionRule.bind(this),
      this._consistencyRule.bind(this),
      this._sheriffConfirmationRule.bind(this),
      this._doctorPatternRule.bind(this),
      this._survivalRule.bind(this),
    ];

    const adjustments = new Map();

    for (const rule of rules) {
      const ruleAdjustments = rule(gameState, history, weights);
      for (const [playerId, delta] of Object.entries(ruleAdjustments)) {
        const current = adjustments.get(playerId) || 0;
        adjustments.set(playerId, current + delta);
      }
    }

    // Apply all adjustments
    for (const [playerId, delta] of adjustments) {
      const current = scores.get(playerId);
      if (current !== undefined) {
        scores.set(playerId, Math.max(0, Math.min(100, current + delta)));
      }
    }

    return scores;
  }

  // ===== SCORING RULES =====

  _lateVoteRule(gameState, history, weights) {
    const adjustments = {};

    for (const event of history) {
      if (event.type === "VOTE" && event.isLateVote) {
        const playerId = event.voterId || event.voter;
        adjustments[playerId] =
          (adjustments[playerId] || 0) + weights.lateVoteWeight;
      }
    }

    return adjustments;
  }

  _voteSwitchRule(gameState, history, weights) {
    const adjustments = {};

    for (const event of history) {
      if (event.type === "VOTE" && event.voteChanged) {
        const playerId = event.voterId || event.voter;
        adjustments[playerId] =
          (adjustments[playerId] || 0) + weights.voteSwitchWeight;
      }
    }

    return adjustments;
  }

  _bandwagonRule(gameState, history, weights) {
    // Simplified: check if voted for current leader with no prior suspicion
    const adjustments = {};

    // Would need more complex vote leader tracking
    // For now, simplified version

    return adjustments;
  }

  _selfPreservationRule(gameState, history, weights) {
    const adjustments = {};

    for (const event of history) {
      if (
        event.type === "VOTE" &&
        event.isLateVote &&
        event.votedWithMajority
      ) {
        const playerId = event.voterId || event.voter;
        adjustments[playerId] =
          (adjustments[playerId] || 0) + weights.selfPreservationWeight;
      }
    }

    return adjustments;
  }

  _aggressionRule(gameState, history, weights) {
    const adjustments = {};
    const accusationCount = {};

    for (const event of history) {
      if (event.type === "MESSAGE" && event.isAccusation) {
        const playerId = event.speakerId || event.speaker;
        accusationCount[playerId] = (accusationCount[playerId] || 0) + 1;
      }
    }

    const avgAccusations =
      Object.values(accusationCount).reduce((a, b) => a + b, 0) /
        Object.keys(accusationCount).length || 0;

    for (const [playerId, count] of Object.entries(accusationCount)) {
      const excess = Math.max(0, count - avgAccusations);
      if (excess > 0) {
        adjustments[playerId] =
          (adjustments[playerId] || 0) + excess * weights.aggressionWeight;
      }
    }

    return adjustments;
  }

  _consistencyRule(gameState, history, weights) {
    // Simplified: reward consistent players
    const adjustments = {};

    // Would need complex consistency tracking
    // For now, simplified version

    return adjustments;
  }

  _sheriffConfirmationRule(gameState, history, weights) {
    const adjustments = {};

    for (const event of history) {
      if (event.type === "ROLE_REVEAL" && event.revealedRole === "sheriff") {
        const result = event.investigationResult;
        const targetId = event.investigatedPlayerId;

        if (result === "Mafia" || result === "mafia") {
          adjustments[targetId] =
            (adjustments[targetId] || 0) + weights.sheriffMafiaBonus;
        } else if (result === "Town" || result === "town") {
          adjustments[targetId] =
            (adjustments[targetId] || 0) + weights.sheriffClearedBonus;
        }
      }
    }

    return adjustments;
  }

  _doctorPatternRule(gameState, history, weights) {
    const adjustments = {};

    // Would need protection pattern tracking
    // For now, simplified version

    return adjustments;
  }

  _survivalRule(gameState, history, weights) {
    const adjustments = {};

    const playerStatus = new Map();

    for (const event of history) {
      if (
        event.type === "DEATH" ||
        (event.phase === "NIGHT_RESOLUTION" && event.deaths)
      ) {
        const deaths =
          event.deaths || (event.deadPlayers || []).map((p) => p.id || p.name);

        for (const killedId of deaths) {
          adjustments[killedId] =
            (adjustments[killedId] || 0) + weights.deathBonus;
        }
      }

      if (event.type === "NIGHT_ENDED" || event.type === "DAY_STARTED") {
        // Each night passed (all survivors get bonus)
        // Would need survivor tracking
      }
    }

    return adjustments;
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  EvidenceRecord,
  PlayerCaseFile,
  EvidenceManager,
  SuspectMeter,
};
