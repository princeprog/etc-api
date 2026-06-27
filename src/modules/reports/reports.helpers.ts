import { BadRequestException } from '@nestjs/common';

import type { ReportQueryDto } from './dto/report-query.dto';

/**
 * Centralized helpers for the reporting module.
 *
 * Every report definition (summary, trend, breakdown) and every export shares
 * the helpers here so business meaning — date windows, period bucketing, money
 * normalization, margin math — stays identical across the UI and CSV outputs.
 */

export type GroupByUnit = 'day' | 'week' | 'month';

export type ResolvedDateRange = {
  /** Inclusive start, or null when the report should be unbounded on the lower end. */
  start: Date | null;
  /** Inclusive end, or null when the report should be unbounded on the upper end. */
  end: Date | null;
};

const DEFAULT_GROUP_BY: GroupByUnit = 'month';

/**
 * Parse and validate the shared `startDate`/`endDate` filters into concrete
 * bounds. Both ends are optional so reports can run unbounded by default.
 */
export function resolveDateRange(query: ReportQueryDto): ResolvedDateRange {
  const start = parseOptionalIsoDate(query.startDate, 'startDate');
  const end = parseOptionalIsoDate(query.endDate, 'endDate');

  if (start && end && start.getTime() > end.getTime()) {
    throw new BadRequestException('startDate must not be after endDate');
  }

  return { start, end };
}

function parseOptionalIsoDate(value: string | undefined, field: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} must be a valid ISO date`);
  }

  return parsed;
}

/** Validate the optional trend grouping, defaulting to monthly buckets. */
export function resolveGroupBy(value: string | undefined): GroupByUnit {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return DEFAULT_GROUP_BY;
  }

  if (normalized === 'day' || normalized === 'week' || normalized === 'month') {
    return normalized;
  }

  throw new BadRequestException(
    `groupBy must be one of: day, week, month (received "${value}")`,
  );
}

export function normalizeOptionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Normalize a Postgres numeric-as-text aggregate (or null) to a fixed 2dp money
 * string. Mirrors the convention used by the sales module so totals stay
 * byte-for-byte consistent across modules.
 */
export function normalizeMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return '0.00';
  }

  const numeric = typeof value === 'number' ? value : Number(value);

  if (Number.isNaN(numeric)) {
    return '0.00';
  }

  return numeric.toFixed(2);
}

/** Safe division returning a fixed-precision percentage string (e.g. "23.5"). */
export function toPercentage(
  numerator: number,
  denominator: number,
  fractionDigits = 1,
) {
  if (!denominator) {
    return (0).toFixed(fractionDigits);
  }

  return ((numerator / denominator) * 100).toFixed(fractionDigits);
}

/** Average of two money-as-text/number values as a fixed 2dp money string. */
export function averageMoney(totalValue: string | number, count: number) {
  if (!count) {
    return '0.00';
  }

  const numeric =
    typeof totalValue === 'number' ? totalValue : Number(totalValue);

  if (Number.isNaN(numeric)) {
    return '0.00';
  }

  return (numeric / count).toFixed(2);
}

/**
 * Human-readable label for a trend bucket, derived from the bucket's start date
 * and the grouping unit. Used primarily so CSV exports read cleanly.
 */
export function formatPeriodLabel(period: string, unit: GroupByUnit) {
  const date = new Date(period);

  if (Number.isNaN(date.getTime())) {
    return period;
  }

  switch (unit) {
    case 'day':
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
    case 'week':
      return `Week of ${date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })}`;
    case 'month':
    default:
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      });
  }
}

export type CsvColumn<TRow> = {
  /** Business-readable header shown in the exported file. */
  header: string;
  /** Resolve the cell value for a row. */
  value: (row: TRow) => string | number | null | undefined;
};

/**
 * Build an RFC-4180-ish CSV string from typed columns and rows. Values are
 * escaped (quotes doubled, fields wrapped when they contain separators) so
 * exported files open cleanly in spreadsheet software.
 */
export function buildCsv<TRow>(columns: CsvColumn<TRow>[], rows: TRow[]) {
  const headerLine = columns
    .map((column) => escapeCsv(column.header))
    .join(',');
  const dataLines = rows.map((row) =>
    columns.map((column) => escapeCsv(column.value(row))).join(','),
  );

  // Prepend a UTF-8 BOM so Excel detects encoding and renders peso/unicode cleanly.
  const bom = String.fromCharCode(0xfeff);
  return `${bom}${[headerLine, ...dataLines].join('\r\n')}\r\n`;
}

function escapeCsv(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/** Build a descriptive, filesystem-safe export filename. */
export function buildExportFilename(domain: string, dataset: string) {
  const stamp = new Date().toISOString().slice(0, 10);
  const safeDataset = dataset.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  return `etc-${domain}-${safeDataset}-${stamp}.csv`;
}
