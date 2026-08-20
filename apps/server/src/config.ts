/**
 * Server configuration constants.
 */

// Default port for a direct `pnpm run server` run. Aligned with the CLI's
// DEFAULT_SERVER_URL (http://localhost:3004) and the compose host port
// (3004:3000). The compose stack sets PORT: "3000" explicitly, so the
// container keeps binding 3000 internally regardless of this default.
// MAF-GAP-052: the old code default (3000) mismatched the CLI default (3004),
// so a fresh direct run + mafiactl pair failed with ECONNREFUSED.
export const DEFAULT_PORT = 3004;
