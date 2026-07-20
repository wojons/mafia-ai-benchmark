/**
 * Benchmark runner routes.
 *
 * Extracted from the monolithic routes/index.ts to reduce file size.
 */

import { Router, Request, Response } from 'express';
import { ServerContext } from '../index.js';

export function createBenchmarkRouter(context: ServerContext): Router {
  const { benchmarkRunner, statsCollector } = context;
  const router = Router();

  // ==================== BENCHMARK ====================

  // Run benchmark
  router.post('/api/v1/benchmark', (req: Request, res: Response) => {
    try {
      const { config = {} } = req.body;
      const result = benchmarkRunner.start(config);
      res.status(201).json({
        success: true,
        data: {
          runId: result.runId,
          totalGames: result.totalGames,
          pairings: result.pairings,
          message: `Benchmark started with ${result.totalGames} game(s)`,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error:
          'Failed to start benchmark: ' + (error as Error).message,
      });
    }
  });

  // Get benchmark report
  router.get('/api/v1/benchmark/report', (req: Request, res: Response) => {
    try {
      const gameId = req.query.gameId as string | undefined;
      const report = statsCollector.generateReport(gameId);

      const format = req.query.format || 'json';

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.send(statsCollector.exportCSV(gameId));
      } else {
        res.json(report);
      }
    } catch (error) {
      res
        .status(500)
        .json({ success: false, error: 'Failed to generate report' });
    }
  });

  // ==================== BENCHMARK EXPORT ====================

  // Export comprehensive benchmark report
  router.get('/api/v1/benchmark/export', (req: Request, res: Response) => {
    try {
      const format = (req.query.format as string) || 'json';
      const games = req.query.games
        ? parseInt(req.query.games as string)
        : undefined;

      const report = statsCollector.getExportReport(games);

      if (format === 'csv') {
        const csv = statsCollector.exportReportCSV(report);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="benchmark-export.csv"',
        );
        res.send(csv);
      } else {
        res.json({
          success: true,
          data: report,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to export benchmark data',
      });
    }
  });

  // Compare models head-to-head
  router.get('/api/v1/benchmark/compare', (req: Request, res: Response) => {
    try {
      const modelsParam = req.query.models as string | undefined;
      const modelFilter = modelsParam
        ? modelsParam.split(',').map((m) => m.trim()).filter(Boolean)
        : undefined;

      const report = statsCollector.getCompareReport(modelFilter);

      res.json({
        success: true,
        data: report,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to generate comparison report',
      });
    }
  });

  // ==================== BENCHMARK RUNNER (managed runs) ====================

  // Get benchmark run status + progress
  router.get(
    '/api/v1/benchmark/runs/:runId',
    (req: Request, res: Response) => {
      try {
        const { runId } = req.params;
        const status = benchmarkRunner.getStatus(runId);
        if (!status) {
          res.status(404).json({
            success: false,
            error: `Benchmark run ${runId} not found`,
          });
          return;
        }
        const progress = benchmarkRunner.getProgress(runId);
        res.json({ success: true, data: { status, progress } });
      } catch (error) {
        res
          .status(500)
          .json({
            success: false,
            error: 'Failed to get benchmark run',
          });
      }
    },
  );

  // Cancel benchmark run
  router.post(
    '/api/v1/benchmark/runs/:runId/cancel',
    (req: Request, res: Response) => {
      try {
        const { runId } = req.params;
        const cancelled = benchmarkRunner.cancel(runId);
        if (!cancelled) {
          res.status(404).json({
            success: false,
            error: `Benchmark run ${runId} not found or already terminal`,
          });
          return;
        }
        res.json({
          success: true,
          data: { runId, message: 'Benchmark run cancelled' },
        });
      } catch (error) {
        res
          .status(500)
          .json({
            success: false,
            error: 'Failed to cancel benchmark run',
          });
      }
    },
  );

  return router;
}
