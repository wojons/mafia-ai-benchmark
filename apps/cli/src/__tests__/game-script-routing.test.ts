/**
 * Guard for the documented `game:*` script routing (README-3).
 *
 * README documents `pnpm --filter @mafia/cli game:run` as the way to run a
 * game. The scripts originally targeted the declaration-only command modules
 * (src/commands/run-game.ts / watch-game.ts) directly — those modules only
 * DECLARE a Commander Command and register it on nothing, so running the
 * script loaded the module and exited 0 with no output: a silent no-op behind
 * a documented entry point.
 *
 * This test parses apps/cli/package.json and asserts that every
 * `game:*`-class script routes through the commander entry point
 * (src/index.ts), which constructs and parses the commands via
 * `program.addCommand(...)` + `program.parseAsync(...)`. A future edit that
 * re-points a script at a declaration-only module goes red here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const pkgPath = path.resolve(__dirname, '../../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

describe('apps/cli package.json game:* script routing (README-3)', () => {
  it('routes every game:*-class script through the commander entry point src/index.ts', () => {
    const gameScripts = Object.entries(pkg.scripts as Record<string, string>)
      .filter(([name]) => name.startsWith('game:'));

    // The documented interface must exist at all — deleting the documented
    // feature is not the fix for a no-op script.
    expect(gameScripts.length).toBeGreaterThanOrEqual(2);
    expect(gameScripts.map(([name]) => name)).toEqual(
      expect.arrayContaining(['game:run', 'game:watch'])
    );

    for (const [name, script] of gameScripts) {
      // Must invoke tsx on the commander entry point src/index.ts with the
      // command name as its first argument — matching the same shape as the
      // benchmark/stats/list-games scripts.
      expect(script, `script "${name}" must call tsx`).toMatch(/^tsx src\/index\.ts /);
      // A bare class-module target (src/commands/*.ts) registers the command
      // on nothing and is a silent no-op — never acceptable as the target.
      expect(script, `script "${name}" must not run a declaration-only module`).not.toMatch(
        /src\/commands\//
      );
    }

    // The command names passed to index.ts must match the registered commander
    // command names (run-game / watch-game), not the npm script spelling.
    const commands: [string, string][] = [
      ['game:run', 'run-game'],
      ['game:watch', 'watch-game'],
    ];
    for (const [name, command] of commands) {
      expect(pkg.scripts[name], `script "${name}" must pass '${command}' to index.ts`).toBe(
        `tsx src/index.ts ${command}`
      );
    }
  });
});