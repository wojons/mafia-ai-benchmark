/**
 * Shared report display helpers (MAF-GAP-059).
 *
 * The `CUSTOM/<bare-model>` legacy floor rows are injected SERVER-SIDE
 * (legacy token_usage carries provider='CUSTOM' with a slash-less model
 * name — see stats-collector/models.ts and benchmark-runner.ts parseModel;
 * the MAF-GAP-057 phantom). Fixing the source is a server change; until
 * then the CLI must not add drift of its own: it renders the same
 * provider/model strings the API reports.
 */

/** Display name for a model row: exactly what the API reports. */
export function displayName(provider: string, model: string): string {
  return `${provider}/${model}`;
}
