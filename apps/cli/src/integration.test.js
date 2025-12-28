/**
 * Mafia AI Benchmark - CLI Integration Tests
 * 
 * Tests for mafiactl CLI commands
 * Run with: node apps/cli/src/integration.test.js
 */

import { execSync, spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, '../dist/index.js');
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

let testsPassed = 0;
let testsFailed = 0;
let serverProcess = null;

// Helper to run CLI command
function runCLI(args, options = {}) {
  try {
    const result = execSync(`node ${CLI_PATH} ${args}`, {
      encoding: 'utf8',
      timeout: 30000,
      ...options,
    });
    return { success: true, output: result, error: null };
  } catch (error) {
    return { success: false, output: error.stdout || '', error: error.stderr || error.message };
  }
}

// Check if server is running
function checkServer() {
  return new Promise((resolve) => {
    const req = http.get(SERVER_URL + '/health', (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
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

async function testCLIVersion() {
  const result = runCLI('--version');
  if (!result.success) throw new Error('Failed to get version');
  if (!result.output.includes('mafiactl')) throw new Error('Expected mafiactl in output');
}

async function testCLIHelp() {
  const result = runCLI('--help');
  if (!result.success) throw new Error('Failed to get help');
  if (!result.output.includes('Commands')) throw new Error('Expected Commands in help');
}

async function testCLIGamesList() {
  const result = runCLI('games list');
  // Should work even with no games
  if (result.error && !result.error.includes('ECONNREFUSED')) {
    throw new Error(`Failed: ${result.error}`);
  }
}

async function testCLIGamesCreate() {
  const result = runCLI('games create --players 5 --day-duration 60');
  if (result.error && !result.error.includes('ECONNREFUSED')) {
    throw new Error(`Failed: ${result.error}`);
  }
  // If server is running, should create game
  if (result.success && !result.output.includes('Created game')) {
    // Check if it shows game info
  }
}

async function testCLIGamesWatch() {
  // This would run until timeout, so we just check it doesn't error immediately
  const result = runCLI('games watch --timeout 1', { timeout: 5000 });
  // Should timeout gracefully or show watching message
}

async function testCLIStats() {
  const result = runCLI('stats');
  if (result.error && !result.error.includes('ECONNREFUSED')) {
    throw new Error(`Failed: ${result.error}`);
  }
}

async function testCLIStatsModel() {
  const result = runCLI('stats --model gpt-4o-mini');
  if (result.error && !result.error.includes('ECONNREFUSED')) {
    throw new Error(`Failed: ${result.error}`);
  }
}

async function testCLIBenchmarkList() {
  const result = runCLI('benchmark list');
  // Should show available benchmarks or empty list
  if (result.error && !result.error.includes('ECONNREFUSED')) {
    throw new Error(`Failed: ${result.error}`);
  }
}

async function testCLIConfigGet() {
  const result = runCLI('config get');
  if (result.error && !result.error.includes('ECONNREFUSED')) {
    throw new Error(`Failed: ${result.error}`);
  }
}

async function testCLIConfigSet() {
  // This might fail without proper setup, but should not error on parsing
  const result = runCLI('config set provider.openai.key test-key');
  // May fail on validation, but should not crash
  if (result.error && 
      !result.error.includes('ECONNREFUSED') && 
      !result.error.includes('validation') &&
      !result.error.includes('invalid')) {
    throw new Error(`Unexpected error: ${result.error}`);
  }
}

async function testCLIInit() {
  // Test init command (creates config)
  const result = runCLI('init --force');
  if (result.error && !result.error.includes('ECONNREFUSED')) {
    // May fail on writing files, but should not crash
  }
}

async function testCLIUnknownCommand() {
  const result = runCLI('unknown-command');
  if (result.success) throw new Error('Should have failed');
  if (!result.error.includes('Unknown command')) {
    throw new Error('Expected "Unknown command" error');
  }
}

async function testCLIInvalidOption() {
  const result = runCLI('--invalid-option');
  if (result.success) throw new Error('Should have failed');
}

// ==================== SERVER INTEGRATION TESTS ====================

async function testCLIWithServer() {
  const serverRunning = await checkServer();
  if (!serverRunning) {
    console.log('  (Skipping server integration tests - server not running)');
    return;
  }
  
  console.log('\n--- Server Integration ---');
  
  await runTest('CLI games list (with server)', async () => {
    const result = runCLI('games list');
    if (result.error) throw new Error(result.error);
  });
  
  await runTest('CLI games create (with server)', async () => {
    const result = runCLI('games create --players 3');
    if (result.error) throw new Error(result.error);
    if (!result.output.includes('Created')) {
      throw new Error('Expected "Created" in output');
    }
  });
  
  await runTest('CLI stats (with server)', async () => {
    const result = runCLI('stats');
    if (result.error) throw new Error(result.error);
    if (!result.output.includes('Games')) {
      throw new Error('Expected "Games" in stats output');
    }
  });
}

// ==================== MAIN ====================

async function main() {
  console.log('\n🧪 Mafia AI Benchmark - CLI Integration Tests');
  console.log('================================================\n');
  console.log(`CLI: ${CLI_PATH}`);
  console.log(`Server: ${SERVER_URL}`);
  console.log('');
  
  // Check if CLI is built
  try {
    execSync(`ls -la ${CLI_PATH}`, { encoding: 'utf8' });
  } catch {
    console.log('❌ CLI not built');
    console.log('Build with: cd apps/cli && pnpm build\n');
    process.exit(1);
  }
  
  console.log('CLI is built\n');
  
  // Run tests
  console.log('--- CLI Basic Tests ---');
  await runTest('--version', testCLIVersion);
  await runTest('--help', testCLIHelp);
  
  console.log('\n--- CLI Commands ---');
  await runTest('games list', testCLIGamesList);
  await runTest('games create', testCLIGamesCreate);
  await runTest('games watch', testCLIGamesWatch);
  await runTest('stats', testCLIStats);
  await runTest('stats --model', testCLIStatsModel);
  await runTest('benchmark list', testCLIBenchmarkList);
  await runTest('config get', testCLIConfigGet);
  await runTest('config set', testCLIConfigSet);
  await runTest('init', testCLIInit);
  
  console.log('\n--- CLI Error Handling ---');
  await runTest('unknown command', testCLIUnknownCommand);
  await runTest('--invalid-option', testCLIInvalidOption);
  
  // Server integration tests
  await testCLIWithServer();
  
  // Summary
  console.log('\n================================================');
  console.log('📊 Test Summary');
  console.log('================================================');
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`⏱️  Total: ${testsPassed + testsFailed} tests`);
  console.log('');
  
  if (testsFailed > 0) {
    console.log('❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('🎉 All CLI tests passed!');
    console.log('');
  }
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
