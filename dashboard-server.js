// ============================================
// REAL-TIME DASHBOARD SERVER
// WebSocket-based live game metrics
// ============================================

const WebSocket = require("ws");

class RealtimeDashboardServer {
  constructor(port = 8080) {
    this.wss = null;
    this.port = port;
    this.clients = new Set();
  }

  /**
   * Start the WebSocket server
   */
  start() {
    this.wss = new WebSocket.Server({ port: this.port });

    this.wss.on("connection", (ws) => {
      console.log(
        `[DASHBOARD] Client connected (${this.clients.size + 1} total)`,
      );

      // Add to clients set
      this.clients.add(ws);

      // Send welcome message
      ws.send(
        JSON.stringify({
          type: "connected",
          message: "Connected to Mafia Dashboard",
          timestamp: Date.now(),
        }),
      );

      // Handle client disconnect
      ws.on("close", () => {
        this.clients.delete(ws);
        console.log(
          `[DASHBOARD] Client disconnected (${this.clients.size} remaining)`,
        );
      });

      // Handle client errors
      ws.on("error", (error) => {
        console.error("[DASHBOARD] Client error:", error.message);
      });
    });

    console.log(`[DASHBOARD] WebSocket server started on port ${this.port}`);
  }

  /**
   * Broadcast game state to all connected clients
   */
  broadcastGameState(gameState) {
    this.broadcast({
      type: "game_state",
      data: gameState,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast player action
   */
  broadcastPlayerAction(playerId, playerName, action) {
    this.broadcast({
      type: "player_action",
      data: {
        playerId,
        playerName,
        action,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast cost update
   */
  broadcastCostUpdate(costReport) {
    this.broadcast({
      type: "cost_update",
      data: costReport,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast chat message
   */
  broadcastChatMessage(playerId, playerName, message, visibility) {
    this.broadcast({
      type: "chat_message",
      data: {
        playerId,
        playerName,
        message,
        visibility,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast phase change
   */
  broadcastPhaseChange(round, phase, phaseName) {
    this.broadcast({
      type: "phase_change",
      data: {
        round,
        phase,
        phaseName,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast player death
   */
  broadcastPlayerDeath(playerId, playerName, role, deathType) {
    this.broadcast({
      type: "player_death",
      data: {
        playerId,
        playerName,
        role,
        deathType,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast voting result
   */
  broadcastVotingResult(result) {
    this.broadcast({
      type: "voting_result",
      data: result,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast game over
   */
  broadcastGameOver(winner, finalState) {
    this.broadcast({
      type: "game_over",
      data: {
        winner,
        finalState,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast evidence update
   */
  broadcastEvidenceUpdate(evidenceData) {
    this.broadcast({
      type: "evidence_update",
      data: evidenceData,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast suspect meter update
   */
  broadcastSuspectMeterUpdate(suspects) {
    this.broadcast({
      type: "suspect_meter_update",
      data: suspects,
      timestamp: Date.now(),
    });
  }

  /**
   * Low-level broadcast method
   */
  broadcast(message) {
    const payload = JSON.stringify(message);

    // Send to all connected clients
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch (error) {
          console.error("[DASHBOARD] Failed to send to client:", error.message);
        }
      }
    });
  }

  /**
   * Stop the WebSocket server
   */
  stop() {
    if (this.wss) {
      this.wss.close();
      this.clients.clear();
      console.log("[DASHBOARD] WebSocket server stopped");
    }
  }

  /**
   * Get stats about connected clients
   */
  getStats() {
    return {
      connectedClients: this.clients.size,
      port: this.port,
      isRunning: !!this.wss,
    };
  }
}

module.exports = RealtimeDashboardServer;
