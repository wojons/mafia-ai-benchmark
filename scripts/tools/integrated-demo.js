// ============================================
// INTEGRATED DEMO - Run everything together
// Dashboard server + 3D visualization + Game
// ============================================

require("dotenv").config();

const { MafiaGame } = require("./game-engine");
const RealtimeDashboardServer = require("./dashboard-server");
const http = require("http");
const fs = require("fs");
const path = require("path");

// Start dashboard WebSocket server
const dashboardServer = new RealtimeDashboardServer(8080);
dashboardServer.start();

// Start HTTP server for serving static files (dashboard & visualization)
const httpServer = http.createServer((req, res) => {
  let filePath = "." + req.url;
  if (filePath === "./") {
    filePath = "./dashboard.html";
  }

  // Serve visualization.html
  if (filePath === "./visualization") {
    filePath = "./visualization.html";
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
  };

  const contentType = mimeTypes[extname] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code == "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<h1>404 Not Found</h1>", "utf-8");
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`, "utf-8");
      }
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content, "utf-8");
    }
  });
});

const HTTP_PORT = 3000;
httpServer.listen(HTTP_PORT, () => {
  console.log(`\n` + "=".repeat(70));
  console.log(`🎮 Mafia AI - Integrated Demo`);
  console.log("=".repeat(70));
  console.log(`\n📊 Dashboard Server: http://localhost:${HTTP_PORT}`);
  console.log(
    `📊 Dashboard View: http://localhost:${HTTP_PORT}/dashboard.html`,
  );
  console.log(
    `🎨 3D Visualization: http://localhost:${HTTP_PORT}/visualization`,
  );
  console.log(`🔌 WebSocket Server: ws://localhost:8080`);
  console.log(`\nPress Ctrl+C to stop.\n`);

  // Start the game
  runGame();
});

async function runGame() {
  console.log("Starting game...");

  const game = new MafiaGame({
    maxRetries: 2,
    enableDatabase: true,
    allowMultiRole: true,
  });

  try {
    await game.startGame(6);

    console.log("\n" + "=".repeat(70));
    console.log("🎉 Game Complete!");
    console.log("=".repeat(70));

    if (game.costTracker) {
      const report = game.costTracker.getCostReport(game.gameId);
      console.log(`Total Cost: $${report.totalCost.toFixed(6)}`);
      console.log(`Budget Used: ${(report.budgetUsedPct * 100).toFixed(2)}%`);
    }
  } catch (error) {
    console.error("\n❌ Game error:", error.message);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\nShutting down...");
  dashboardServer.stop();
  httpServer.close();
  process.exit(0);
});
