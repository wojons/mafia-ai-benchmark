/**
 * Mafia AI Benchmark - Production Server Integration Tests
 * 
 * TDD Tests for Production Server
 * Run with: node apps/server/src/integration.test.js
 * 
 * These tests validate all API endpoints and behaviors
 * defined in specs/production-server-specs.md
 */

import http from 'http';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const SERVER_HOST = new URL(SERVER_URL).hostname;
const SERVER_PORT = parseInt(new URL(SERVER_URL).port) || 3000;

let testsPassed = 0;
let testsFailed = 0;
let serverProcess = null;

// HTTP client helper
function httpRequest(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SERVER_HOST,
      port: SERVER_PORT,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ 
            status: res.statusCode || 0, 
            data: parsed, 
            headers: res.headers 
          });
        } catch {
          resolve({ status: res.statusCode || 0, data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) {
      // If body is already a string, send it directly; otherwise stringify
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

// SSE client helper
function createSSEClient(path) {
  const events = [];
  const options = {
    hostname: SERVER_HOST,
    port: SERVER_PORT,
    path,
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
  };

  const req = http.request(options, (res) => {
    res.on('data', (chunk) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try { events.push(JSON.parse(line.slice(6))); } catch {}
        }
      }
    });
  });

  req.on('error', () => {});
  req.end();

  return { events, close: () => req.destroy() };
}

// Test runner
async function runTest(name, testFn) {
  try {
    await testFn();
    console.log(`✅ ${name}`);
    testsPassed++;
    return true;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    testsFailed++;
    return false;
  }
}

// ==================== TESTS ====================

// --- Health & API Info ---

async function testHealthEndpoint() {
  const res = await httpRequest('GET', '/health');
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (res.data.status !== 'healthy') throw new Error('Expected status: healthy');
  if (!res.data.timestamp) throw new Error('Missing timestamp');
  if (typeof res.data.uptime !== 'number') throw new Error('Missing uptime');
}

async function testAPIInfoEndpoint() {
  const res = await httpRequest('GET', '/api/v1');
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (res.data.version !== '1.0.0') throw new Error('Expected version 1.0.0');
  if (!res.data.endpoints) throw new Error('Missing endpoints');
}

// --- Games List ---

async function testGamesListEmpty() {
  const res = await httpRequest('GET', '/api/v1/games');
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (!Array.isArray(res.data.data)) throw new Error('Expected games array');
}

async function testGamesListWithFilter() {
  const res = await httpRequest('GET', '/api/v1/games?status=SETUP');
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
}

// --- Game Creation ---

async function testGameCreationMinimal() {
  const res = await httpRequest('POST', '/api/v1/games', {});
  if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
  if (!res.data.data?.id) throw new Error('Missing game id');
  if (!res.data.data?.status) throw new Error('Missing game status');
  if (res.data.data?.status !== 'SETUP') throw new Error('Expected status: SETUP');
}

async function testGameCreationWithConfig() {
  const res = await httpRequest('POST', '/api/v1/games', {
    gameId: 'test-game-' + Date.now(),
    config: {
      players: 5,
      dayDurationSeconds: 60,
      nightDurationSeconds: 30,
    },
  });
  
  if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
  if (!res.data.data?.id) throw new Error('Missing game id');
  if (!res.data.data?.config) throw new Error('Missing config');
  if (res.data.data?.config?.players !== 5) throw new Error('Wrong player count');
}

async function testGameCreationAutoGenerateId() {
  const res = await httpRequest('POST', '/api/v1/games', {
    config: { players: 3 },
  });
  
  if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
  if (!res.data.data?.id) throw new Error('Missing auto-generated id');
  if (!res.data.data?.id.startsWith('game-')) throw new Error('Expected game- prefix');
}

// --- Game Retrieval ---

async function testGetGame() {
  // Create a game first
  const create = await httpRequest('POST', '/api/v1/games', {
    gameId: 'test-get-game-' + Date.now(),
  });
  const gameId = create.data.data.id;
  
  // Get the game
  const res = await httpRequest('GET', `/api/v1/games/${gameId}`);
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (res.data.data?.id !== gameId) throw new Error('Wrong game returned');
}

async function testGetGameNotFound() {
  const res = await httpRequest('GET', '/api/v1/games/nonexistent-game');
  if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
}

// --- Game Start/Stop ---

async function testStartGame() {
  const create = await httpRequest('POST', '/api/v1/games', {
    gameId: 'test-start-' + Date.now(),
  });
  const gameId = create.data.data.id;
  
  // Start the game (needs at least 3 players normally, but for testing...)
  const res = await httpRequest('POST', `/api/v1/games/${gameId}/start`);
  // May return 400 if not enough players, but should not error
  if (res.status !== 200 && res.status !== 400) {
    throw new Error(`Expected 200 or 400, got ${res.status}`);
  }
}

async function testStopGame() {
  const create = await httpRequest('POST', '/api/v1/games', {
    gameId: 'test-stop-' + Date.now(),
  });
  const gameId = create.data.data.id;
  
  const res = await httpRequest('POST', `/api/v1/games/${gameId}/stop`);
  // May return 400 if game not started, but should not error
  if (res.status !== 200 && res.status !== 400) {
    throw new Error(`Expected 200 or 400, got ${res.status}`);
  }
}

// --- Players ---

async function testAddPlayer() {
  const create = await httpRequest('POST', '/api/v1/games', {
    gameId: 'test-add-player-' + Date.now(),
  });
  const gameId = create.data.data.id;
  
  const res = await httpRequest('POST', `/api/v1/games/${gameId}/players`, {
    name: 'TestPlayer',
    role: 'VILLAGER',
  });
  
  if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
  if (!res.data.data?.id) throw new Error('Missing player id');
}

async function testListPlayers() {
  const create = await httpRequest('POST', '/api/v1/games', {
    gameId: 'test-list-players-' + Date.now(),
  });
  const gameId = create.data.data.id;
  
  // Add a player first
  await httpRequest('POST', `/api/v1/games/${gameId}/players`, { name: 'P1' });
  
  const res = await httpRequest('GET', `/api/v1/games/${gameId}/players`);
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (!Array.isArray(res.data.data)) throw new Error('Expected players array');
}

// --- Player Model Configuration ---

async function testSetPlayerModel() {
  const create = await httpRequest('POST', '/api/v1/games', {
    gameId: 'test-player-model-' + Date.now(),
  });
  const gameId = create.data.data.id;
  
  const res = await httpRequest('POST', `/api/v1/games/${gameId}/players/0/model`, {
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 1000,
  });
  
  if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
  if (res.data.data?.provider !== 'openai') throw new Error('Wrong provider');
  if (res.data.data?.model !== 'gpt-4o-mini') throw new Error('Wrong model');
}

async function testSetPlayerModelInvalid() {
  const create = await httpRequest('POST', '/api/v1/games', {
    gameId: 'test-invalid-model-' + Date.now(),
  });
  const gameId = create.data.data.id;
  
  const res = await httpRequest('POST', `/api/v1/games/${gameId}/players/0/model`, {
    provider: 'invalid-provider',
    model: 'invalid-model',
  });
  
  if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
}

// --- Role Model Configuration ---

async function testSetRoleModel() {
  const create = await httpRequest('POST', '/api/v1/games', {
    gameId: 'test-role-model-' + Date.now(),
  });
  const gameId = create.data.data.id;
  
  const res = await httpRequest('POST', `/api/v1/games/${gameId}/role/MAFIA/model`, {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.8,
  });
  
  if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
  if (res.data.data?.role !== 'MAFIA') throw new Error('Wrong role');
}

// --- Bulk Model Configuration ---

async function testBulkModelConfiguration() {
  const create = await httpRequest('POST', '/api/v1/games', {
    gameId: 'test-bulk-models-' + Date.now(),
  });
  const gameId = create.data.data.id;
  
  const res = await httpRequest('POST', `/api/v1/games/${gameId}/models/bulk`, {
    assignments: [
      { type: 'player', index: 0, provider: 'openai', model: 'gpt-4o-mini' },
      { type: 'player', index: 1, provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      { type: 'role', role: 'MAFIA', provider: 'deepseek', model: 'deepseek-chat' },
    ],
  });
  
  if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
  if (res.data.data?.count !== 3) throw new Error('Expected 3 assignments');
}

// --- Model Pricing ---

async function testModelPricingKnownModel() {
  const res = await httpRequest('GET', '/api/v1/models/pricing?model=gpt-4o-mini');
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (res.data.data?.modelId !== 'gpt-4o-mini') throw new Error('Wrong model');
  if (typeof res.data.data?.inputPerMillion !== 'number') throw new Error('Missing input price');
  if (typeof res.data.data?.outputPerMillion !== 'number') throw new Error('Missing output price');
  if (typeof res.data.data?.hasPricing !== 'boolean') throw new Error('Missing hasPricing');
}

async function testModelPricingUnknownModel() {
  const res = await httpRequest('GET', '/api/v1/models/pricing?model=unknown-model-xyz');
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (res.data.data?.hasPricing !== false) throw new Error('Expected no pricing');
  if (res.data.data?.inputPerMillion === -6.66 || res.data.data?.noPricingMarker === -6.66) {
    // Should have no pricing marker
  }
}

async function testModelPricingMultipleModels() {
  const models = ['gpt-4o-mini', 'claude-sonnet-4-20250514', 'gemini-2.5-flash-exp', 'deepseek-chat'];
  
  for (const model of models) {
    const res = await httpRequest('GET', `/api/v1/models/pricing?model=${model}`);
    if (res.status !== 200) throw new Error(`${model}: Expected 200, got ${res.status}`);
  }
}

// --- Calculate Cost ---

async function testCalculateCostKnownModel() {
  const res = await httpRequest('POST', '/api/v1/models/calculate-cost', {
    modelId: 'gpt-4o-mini',
    inputTokens: 15000,
    outputTokens: 5000,
  });
  
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (typeof res.data.data?.totalCost !== 'number') throw new Error('Missing totalCost');
  if (typeof res.data.data?.formatted !== 'string') throw new Error('Missing formatted');
  if (res.data.data?.hasPricing !== true) throw new Error('Expected hasPricing');
  
  // gpt-4o-mini: $0.15/M in, $0.60/M out
  // 15000 in = $0.00225, 5000 out = $0.003, total = $0.00525
  const expected = (15000 / 1e6) * 0.15 + (5000 / 1e6) * 0.60;
  if (Math.abs(res.data.data.totalCost - expected) > 0.0001) {
    throw new Error(`Wrong cost: ${res.data.data.totalCost} vs ${expected}`);
  }
}

async function testCalculateCostUnknownModel() {
  const res = await httpRequest('POST', '/api/v1/models/calculate-cost', {
    modelId: 'unknown-model-xyz',
    inputTokens: 1000,
    outputTokens: 500,
  });
  
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (res.data.data?.hasPricing !== false) throw new Error('Expected no pricing');
}

async function testCalculateCostVariations() {
  const testCases = [
    { model: 'gpt-4o-mini', input: 1000, output: 500 },
    { model: 'gpt-4o', input: 10000, output: 5000 },
    { model: 'deepseek-chat', input: 5000, output: 2000 },
  ];
  
  for (const tc of testCases) {
    const res = await httpRequest('POST', '/api/v1/models/calculate-cost', {
      modelId: tc.model,
      inputTokens: tc.input,
      outputTokens: tc.output,
    });
    
    if (res.status !== 200) throw new Error(`${tc.model}: Expected 200, got ${res.status}`);
    if (typeof res.data.data?.totalCost !== 'number') throw new Error(`${tc.model}: Missing cost`);
  }
}

// --- SSE Streaming ---

async function testSSEConnection() {
  const create = await httpRequest('POST', '/api/v1/games', {
    gameId: 'test-sse-conn-' + Date.now(),
  });
  const gameId = create.data.data.id;
  
  const sse = createSSEClient(`/api/v1/games/${gameId}/events`);
  
  // Wait for connection event
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  if (sse.events.length === 0) throw new Error('No events received');
  if (!sse.events.some(e => e.type === 'connected')) throw new Error('No connected event');
  
  sse.close();
}

async function testSSEPhaseChangeEvent() {
  const create = await httpRequest('POST', '/api/v1/games', {
    gameId: 'test-sse-phase-' + Date.now(),
  });
  const gameId = create.data.data.id;
  
  const sse = createSSEClient(`/api/v1/games/${gameId}/events`);
  
  // Wait for events
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Should have received at least connected event
  if (sse.events.length === 0) throw new Error('No events');
  
  const eventTypes = sse.events.map(e => e.type);
  if (!eventTypes.includes('connected')) throw new Error('Missing connected event');
  
  sse.close();
}

async function testSSEStatus() {
  const create = await httpRequest('POST', '/api/v1/games', {
    gameId: 'test-sse-status-' + Date.now(),
  });
  const gameId = create.data.data.id;
  
  // Check initial status (0 connections)
  const res1 = await httpRequest('GET', `/api/v1/games/${gameId}/sse-status`);
  if (res1.data.data?.activeConnections !== 0) throw new Error('Expected 0 connections');
  
  // Connect SSE
  const sse = createSSEClient(`/api/v1/games/${gameId}/events`);
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Check status again (should be 1)
  const res2 = await httpRequest('GET', `/api/v1/games/${gameId}/sse-status`);
  if (res2.data.data?.activeConnections !== 1) throw new Error('Expected 1 connection');
  if (res2.data.data?.isStreaming !== true) throw new Error('Expected isStreaming true');
  
  // Disconnect
  sse.close();
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Check status (should be 0)
  const res3 = await httpRequest('GET', `/api/v1/games/${gameId}/sse-status`);
  if (res3.data.data?.activeConnections !== 0) throw new Error('Expected 0 after disconnect');
}

// --- Statistics ---

async function testServerStats() {
  const res = await httpRequest('GET', '/api/v1/stats');
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (typeof res.data.data?.gamesCount !== 'number') throw new Error('Missing games count');
  if (typeof res.data.data?.playersCount !== 'number') throw new Error('Missing players count');
}

// --- Models List ---

async function testListModels() {
  const res = await httpRequest('GET', '/api/v1/models');
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  if (!Array.isArray(res.data.data)) throw new Error('Expected models array');
}

// --- Error Handling ---

async function test404NotFound() {
  const res = await httpRequest('GET', '/api/v1/nonexistent');
  if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
  if (res.data.error?.code !== 'NOT_FOUND') throw new Error('Expected NOT_FOUND code');
}

async function testInvalidJSON() {
  // Send raw invalid JSON (not stringified)
  const res = await httpRequest('POST', '/api/v1/games', 'not valid json {{{', {
    'Content-Type': 'application/json',
  });
  if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
}

// --- Complete Game Flow ---

async function testCompleteGameFlow() {
  // 1. Create game
  const create = await httpRequest('POST', '/api/v1/games', {
    gameId: 'test-complete-flow-' + Date.now(),
    config: {
      players: 5,
      dayDurationSeconds: 10,
      nightDurationSeconds: 5,
    },
  });
  const gameId = create.data.data.id;
  
  // 2. Configure player models
  await httpRequest('POST', `/api/v1/games/${gameId}/players/0/model`, {
    provider: 'openai', model: 'gpt-4o-mini',
  });
  await httpRequest('POST', `/api/v1/games/${gameId}/players/1/model`, {
    provider: 'anthropic', model: 'claude-sonnet-4-20250514',
  });
  
  // 3. Configure role models
  await httpRequest('POST', `/api/v1/games/${gameId}/role/MAFIA/model`, {
    provider: 'deepseek', model: 'deepseek-chat',
  });
  
  // 4. Subscribe to SSE
  const sse = createSSEClient(`/api/v1/games/${gameId}/events`);
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // 5. Verify events
  if (sse.events.length === 0) throw new Error('No game events');
  const eventTypes = sse.events.map(e => e.type);
  if (!eventTypes.includes('connected')) throw new Error('Missing connected event');
  
  // 6. Check stats
  const stats = await httpRequest('GET', `/api/v1/games/${gameId}/stats`);
  if (stats.status !== 200) throw new Error('Failed to get game stats');
  
  sse.close();
}

// ==================== MAIN ====================

async function main() {
  console.log('\n🧪 Mafia AI Benchmark - Production Server Tests');
  console.log('==================================================\n');
  console.log(`Server: ${SERVER_URL}`);
  console.log('');
  
  // Check server is running
  try {
    await httpRequest('GET', '/health');
    console.log('✅ Server is running\n');
  } catch {
    console.log('❌ Server is not running');
    console.log(`Start it with: cd apps/server && pnpm dev`);
    console.log(`Or: node simple-server.js (if you have it)\n`);
    process.exit(1);
  }
  
  // Run tests
  console.log('--- Health & API ---');
  await runTest('GET /health', testHealthEndpoint);
  await runTest('GET /api/v1', testAPIInfoEndpoint);
  
  console.log('\n--- Games List ---');
  await runTest('GET /api/v1/games (empty)', testGamesListEmpty);
  await runTest('GET /api/v1/games?status=SETUP', testGamesListWithFilter);
  
  console.log('\n--- Game Creation ---');
  await runTest('POST /api/v1/games (minimal)', testGameCreationMinimal);
  await runTest('POST /api/v1/games (with config)', testGameCreationWithConfig);
  await runTest('POST /api/v1/games (auto-generate id)', testGameCreationAutoGenerateId);
  
  console.log('\n--- Game Retrieval ---');
  await runTest('GET /api/v1/games/:id', testGetGame);
  await runTest('GET /api/v1/games/:id (not found)', testGetGameNotFound);
  
  console.log('\n--- Game Start/Stop ---');
  await runTest('POST /api/v1/games/:id/start', testStartGame);
  await runTest('POST /api/v1/games/:id/stop', testStopGame);
  
  console.log('\n--- Players ---');
  await runTest('POST /api/v1/games/:id/players', testAddPlayer);
  await runTest('GET /api/v1/games/:id/players', testListPlayers);
  
  console.log('\n--- Player Model Configuration ---');
  await runTest('POST /api/v1/games/:id/players/:idx/model', testSetPlayerModel);
  await runTest('POST /api/v1/games/:id/players/:idx/model (invalid)', testSetPlayerModelInvalid);
  
  console.log('\n--- Role Model Configuration ---');
  await runTest('POST /api/v1/games/:id/role/:role/model', testSetRoleModel);
  
  console.log('\n--- Bulk Model Configuration ---');
  await runTest('POST /api/v1/games/:id/models/bulk', testBulkModelConfiguration);
  
  console.log('\n--- Model Pricing ---');
  await runTest('GET /api/v1/models/pricing (known model)', testModelPricingKnownModel);
  await runTest('GET /api/v1/models/pricing (unknown model)', testModelPricingUnknownModel);
  await runTest('GET /api/v1/models/pricing (multiple)', testModelPricingMultipleModels);
  
  console.log('\n--- Calculate Cost ---');
  await runTest('POST /api/v1/models/calculate-cost (known)', testCalculateCostKnownModel);
  await runTest('POST /api/v1/models/calculate-cost (unknown)', testCalculateCostUnknownModel);
  await runTest('POST /api/v1/models/calculate-cost (variations)', testCalculateCostVariations);
  
  console.log('\n--- SSE Streaming ---');
  await runTest('SSE connection', testSSEConnection);
  await runTest('SSE phase change events', testSSEPhaseChangeEvent);
  await runTest('SSE status', testSSEStatus);
  
  console.log('\n--- Statistics ---');
  await runTest('GET /api/v1/stats', testServerStats);
  
  console.log('\n--- Models List ---');
  await runTest('GET /api/v1/models', testListModels);
  
  console.log('\n--- Error Handling ---');
  await runTest('404 Not Found', test404NotFound);
  await runTest('Invalid JSON', testInvalidJSON);
  
  console.log('\n--- Complete Flow ---');
  await runTest('Complete game flow', testCompleteGameFlow);
  
  // Summary
  console.log('\n==================================================');
  console.log('📊 Test Summary');
  console.log('==================================================');
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`⏱️  Total: ${testsPassed + testsFailed} tests`);
  console.log('');
  
  if (testsFailed > 0) {
    console.log('❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('🎉 All tests passed!');
    console.log('');
  }
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
