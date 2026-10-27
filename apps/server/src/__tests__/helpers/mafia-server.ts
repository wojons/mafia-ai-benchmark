/**
 * Shared live-server gate for integration tests that need a REAL mafia
 * server (see api-live-endpoints.test.ts / health.test.ts; api.test.ts is
 * hermetic and no longer uses this — README-7).
 *
 * Host port 3000 is owned by DuckBrain's HTTP server on fleet hosts; the
 * mafia compose stack exposes the server on :3004 (docker "3004:3000") and
 * direct runs should use PORT=3004. CI starts its own source server on :3004
 * and pins TEST_BASE_URL to that host port (see .github/workflows/ci.yml).
 */
export const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3004';

/**
 * README-7 (data-integrity): the live integration suites may WRITE to the
 * server they run against (POST /api/v1/games starts real games whose rows
 * outlive the run), so pointing them at the implicit :3004 fallback silently
 * mutated whatever compose stack a reader had up. Live integration now runs
 * ONLY when TEST_BASE_URL is set explicitly: the operator has pinned a
 * specific, disposable server. The implicit fallback stays available for
 * read-only tooling (mafiactl --server), never for the test suites.
 */
export const LIVE_INTEGRATION_ENABLED = process.env.TEST_BASE_URL !== undefined;

/**
 * Pre-test probe: live integration tests additionally require the pinned URL
 * to BE a mafia server. Fresh contributors running `pnpm test` from the root
 * often have no server up, and on fleet hosts the loopback port 3000 is owned
 * by DuckBrain's HTTP daemon (its /health returns 200 but has no `memory`
 * field), which used to surface as confusing red failures. The suite is
 * skipped with a clear message unless the resolved base URL is a reachable
 * mafia server (GET /health with a `memory` field in the JSON body
 * discriminates a mafia server from DuckBrain).
 */
export async function probeMafiaServer(baseUrl: string): Promise<{ available: boolean; message: string }> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      return {
        available: false,
        message: `no mafia server reachable at ${baseUrl} (GET /health -> HTTP ${response.status}); set TEST_BASE_URL to run`,
      };
    }
    const data = await response.json();
    if (typeof data.memory === 'undefined') {
      return {
        available: false,
        message: `a non-mafia service responded at ${baseUrl} (/health has no \`memory\` field); set TEST_BASE_URL to a running mafia server to run`,
      };
    }
    return { available: true, message: `mafia server reachable at ${baseUrl}` };
  } catch (error) {
    return {
      available: false,
      message: `no mafia server reachable at ${baseUrl} (${(error as Error).message}); set TEST_BASE_URL to run`,
    };
  }
}