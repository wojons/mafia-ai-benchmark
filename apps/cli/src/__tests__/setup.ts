/**
 * CLI test setup — pin the colour environment.
 *
 * This suite asserts on the CLI's human-readable output: in-process
 * `console.log` captures (watch-game/config/run-game/benchmark) and real-argv
 * children spawned through tsx (parse/surface). Colour is an environment
 * property, not CLI behaviour under test, but chalk derives it from the
 * inherited environment (its vendored supports-color reads FORCE_COLOR /
 * NO_COLOR / CI / TERM at import time). With `FORCE_COLOR=1` exported by the
 * caller, chalk wraps the interpolated values inside every line:
 *
 *   "  Phase:     \u001b[36mNIGHT\u001b[39m"
 *
 * so content assertions that pin an exact plain string ("Phase:     NIGHT")
 * fail even though the CLI printed the right thing. Deterministic fix: pin the
 * colour env here rather than making every assertion colour-aware — one setup
 * file covers the whole suite (current and future assertions), and
 * `FORCE_COLOR=0` wins over the other detection branches in supports-color.
 *
 * Children spawned by the argv tests inherit the parent env, so the pin applies
 * to those too: the whole suite renders plain text no matter what the caller
 * exported.
 */
process.env.FORCE_COLOR = '0';
