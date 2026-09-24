/**
 * Body-parse error middleware (DF-MAFIA-AI-BENCHMARK-5).
 *
 * Express body-parser emits an `entity.parse.failed` error for syntactically
 * invalid JSON bodies. That is a CLIENT error: answer HTTP 400 with the
 * standard { success, error: { code, message } } envelope instead of letting
 * it fall through to the generic 500 INTERNAL_ERROR handler.
 *
 * Imported by src/index.ts (before the generic error handler) and by the
 * malformed-JSON contract tests, so the tests exercise the exact production
 * handler.
 */
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';

export function bodyParseErrorHandler(): ErrorRequestHandler {
  return (err: Error, _req: Request, res: Response, next: NextFunction) => {
    const typed = err as { type?: string; status?: number };
    const isParseFailure =
      typed.type === 'entity.parse.failed' ||
      (err instanceof SyntaxError && typed.status === 400);
    if (isParseFailure) {
      res.status(400).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Request body is not valid JSON',
        },
      });
      return;
    }
    next(err);
  };
}