import { DEFAULT_STALE_LEAD_DAYS } from './lead-pipeline.constants';

export function resolveLastActivityAt(lead: {
  latestActivityAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}) {
  return lead.latestActivityAt ?? lead.updatedAt ?? lead.createdAt ?? null;
}

export function isPipelineStale(
  lastActivityAt: Date | null,
  staleAfterDays: number,
) {
  if (!lastActivityAt) {
    return true;
  }

  return (
    Date.now() - lastActivityAt.getTime() >=
    staleAfterDays * 24 * 60 * 60 * 1000
  );
}

export function getPipelineStaleLeadDays() {
  const rawValue = process.env.LEAD_PIPELINE_STALE_DAYS?.trim();
  const parsed = rawValue ? Number(rawValue) : DEFAULT_STALE_LEAD_DAYS;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_STALE_LEAD_DAYS;
  }

  return Math.floor(parsed);
}

export function getLatestDate(dates: Date[]) {
  if (dates.length === 0) {
    return null;
  }

  return dates.reduce((latest, current) =>
    current.getTime() > latest.getTime() ? current : latest,
  );
}
