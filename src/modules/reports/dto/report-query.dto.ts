/**
 * Shared filter contract for every reporting surface.
 *
 * All report endpoints accept the same query shape so the UI, JSON responses,
 * and CSV exports stay driven by one consistent set of operational filters.
 * Not every report uses every field (e.g. inventory snapshots ignore the sales
 * `agentName` filter), but keeping a single contract means new filters can be
 * added without reshaping each endpoint.
 */
export class ReportQueryDto {
  /** Inclusive lower bound (ISO 8601). Applied to the domain's primary date column. */
  startDate?: string;

  /** Inclusive upper bound (ISO 8601). Applied to the domain's primary date column. */
  endDate?: string;

  /** Trend bucket size for time-series reports: `day` | `week` | `month`. Defaults to `month`. */
  groupBy?: string;

  /** Restrict sales/profitability reports to a single sales agent (case-insensitive). */
  agentName?: string;

  /** Domain-specific status filter (e.g. a vehicle or lead status) where the report supports it. */
  status?: string;
}

/**
 * Export query contract — extends the shared filters with a `dataset` selector
 * so a single per-domain export endpoint can emit any of that domain's tables
 * while reflecting the exact filters the user is reviewing.
 */
export class ReportExportQueryDto extends ReportQueryDto {
  /** Which tabular dataset within the domain to export (e.g. `trend`, `by-agent`). */
  dataset?: string;
}
