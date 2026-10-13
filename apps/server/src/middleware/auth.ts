/**
 * Optional admin token auth (MAF-REV-004).
 *
 * The server serves ADMIN-visibility events (e.g. AGENT_THINK_STARTED /
 * COMPLETED THINK text — mapped from the legacy engine's ADMIN_ONLY events in
 * legacy-game-adapter.ts) and accepts game creation with no authentication:
 * routes/games.ts defaulted the events visibility filter to 'all' and the
 * adapter maps ADMIN_ONLY -> ADMIN, so any network client could read them.
 *
 * This middleware is strictly ADDITIVE and OPT-IN:
 *  - When ADMIN_AUTH_TOKEN is unset the auth layer is DISABLED and every
 *    request passes through untouched — localhost dev, the dashboard and all
 *    existing tests keep behaving exactly as before.
 *  - When it IS set, requests must carry the token to
 *      (a) expose ADMIN-visibility events: GET /api/v1/games/:gameId/events
 *          with visibility "all" (the default) or "private"/"admin", and
 *      (b) create games: POST /api/v1/games (any engine path).
 *    Public-visibility event requests stay open without credentials.
 *  Failures answer 401 JSON { success: false, error: 'unauthorized' }.
 *
 * Token transport: `Authorization: Bearer <token>` or `X-Admin-Token: <token>`.
 *
 * The token is re-read from the environment on every request (no boot-time
 * capture) and an in-module override exists so tests can toggle auth without
 * process.env mutation races (see setAdminAuthOverride).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Shape every auth failure answers with. */
const UNAUTHORIZED_BODY = { success: false, error: 'unauthorized' } as const;

/**
 * Test/programmatic override: when defined (even to null = auth disabled),
 * it wins over process.env.ADMIN_AUTH_TOKEN. `undefined` = no override.
 */
let adminTokenOverride: string | null | undefined;

/**
 * Toggle helper for tests: pass a token string to force auth ON with that
 * token, `null` to force auth OFF, or `undefined` to return control to
 * process.env.ADMIN_AUTH_TOKEN.
 */
export function setAdminAuthOverride(token: string | null | undefined): void {
  adminTokenOverride = token;
}

/** The effective admin token, or null when auth is DISABLED. */
export function getAdminAuthToken(): string | null {
  if (adminTokenOverride !== undefined) return adminTokenOverride;
  const fromEnv = process.env.ADMIN_AUTH_TOKEN;
  return fromEnv && fromEnv.trim() !== '' ? fromEnv : null;
}

/** True when the auth layer is enforcing (ADMIN_AUTH_TOKEN set). */
export function isAdminAuthEnabled(): boolean {
  return getAdminAuthToken() !== null;
}

/**
 * Constant-time string equality (hashed first so differing lengths cannot be
 * distinguished by the comparison time).
 */
function tokensEqual(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** True when the request carries the configured admin token. */
export function hasAdminCredentials(req: Request): boolean {
  const token = getAdminAuthToken();
  if (token === null) return true; // auth disabled — everything is "authorized"

  const authz = req.headers.authorization;
  if (typeof authz === 'string') {
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (m && tokensEqual(m[1].trim(), token)) return true;
  }

  const headerToken = req.headers['x-admin-token'];
  if (typeof headerToken === 'string' && headerToken.trim() !== '') {
    return tokensEqual(headerToken.trim(), token);
  }

  return false;
}

/** GET /api/v1/games/:gameId/events (REST JSON and SSE share this route). */
const EVENTS_ROUTE = /^\/api\/v1\/games\/[^/]+\/events$/;

/** Visibility query values that would expose ADMIN-visibility events. */
const ADMIN_EXPOSING_VISIBILITIES = new Set(['all', 'private', 'admin']);

/**
 * Would THIS request expose ADMIN-visibility events if it were allowed
 * through? Only 'public' visibility is safe for unauthenticated clients.
 */
export function exposesAdminVisibility(req: Request): boolean {
  if (req.method !== 'GET') return false;
  if (!EVENTS_ROUTE.test(req.path)) return false;
  const visibility = (Array.isArray(req.query.visibility) ? req.query.visibility[0] : req.query.visibility) as
    | string
    | undefined;
  // Missing visibility defaults to 'all' on the route — the exposing default.
  return visibility === undefined || ADMIN_EXPOSING_VISIBILITIES.has(visibility);
}

/** POST /api/v1/games is the game-creation endpoint (any engine path). */
export function isGameCreationRequest(req: Request): boolean {
  return req.method === 'POST' && req.path === '/api/v1/games';
}

/**
 * The middleware proper. Mount AFTER cors/json, BEFORE the routers.
 * Disabled (passthrough) whenever the admin token is unset.
 */
export function adminAuthMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isAdminAuthEnabled()) {
      next();
      return;
    }

    if (
      (exposesAdminVisibility(req) || isGameCreationRequest(req)) &&
      !hasAdminCredentials(req)
    ) {
      res.status(401).json(UNAUTHORIZED_BODY);
      return;
    }

    next();
  };
}

/**
 * Route-level defense in depth for GET .../events (MAF-REV-004): when auth is
 * enforced but the request carries NO admin credentials, the caller gets
 * public-only events instead of the default 'all' filter — even if this
 * router is mounted without the global middleware. Returns the visibility to
 * filter with ('public') or null when the caller's filter may stand.
 */
export function publicOnlyFallbackVisibility(req: Request): 'public' | null {
  if (!isAdminAuthEnabled()) return null;
  if (hasAdminCredentials(req)) return null;
  const visibility = (Array.isArray(req.query.visibility) ? req.query.visibility[0] : req.query.visibility) as
    | string
    | undefined;
  if (visibility === 'public') return null; // already the safe filter
  return 'public';
}

/**
 * WebSocket-side credential check (DF-MAFIA-AI-BENCHMARK-34). The /ws upgrade
 * is a plain GET with browser-native headers, so the SAME token transports the
 * HTTP path uses compare cleanly: `Authorization: Bearer <token>` and
 * `X-Admin-Token: <token>`. Browsers cannot set custom headers on a WebSocket
 * handshake, so `?token=<token>` on the upgrade URL is accepted too — the
 * token stays in the URL only if the caller puts it there, which is the same
 * trade-off every query-param-token WS design makes.
 *
 * Auth disabled (no ADMIN_AUTH_TOKEN) => true, mirroring hasAdminCredentials.
 * Deliberately shares getAdminAuthToken + tokensEqual so the WS path can never
 * drift from the HTTP token rules.
 */
export function hasAdminCredentialsForSocket(req: {
  headers: { authorization?: unknown; 'x-admin-token'?: unknown };
  url?: string;
}): boolean {
  const token = getAdminAuthToken();
  if (token === null) return true;

  const authz = req.headers.authorization;
  if (typeof authz === 'string') {
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (m && tokensEqual(m[1].trim(), token)) return true;
  }

  const headerToken = req.headers['x-admin-token'];
  if (typeof headerToken === 'string' && headerToken.trim() !== '') {
    if (tokensEqual(headerToken.trim(), token)) return true;
  }

  // WebSocket handshake fallback: ?token= / &token= on the upgrade URL.
  if (typeof req.url === 'string' && req.url.includes('token=')) {
    try {
      const query = new URL(req.url, 'ws://upgrade.invalid').searchParams;
      const provided = query.get('token');
      if (provided && provided.trim() !== '') {
        return tokensEqual(provided.trim(), token);
      }
    } catch {
      // unparseable URL = no token transport found; fall through to deny.
    }
  }

  return false;
}
