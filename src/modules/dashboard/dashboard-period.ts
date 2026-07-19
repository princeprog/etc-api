import { BadRequestException } from '@nestjs/common';

import type { GroupByUnit } from '../reports/reports.helpers';

export const DASHBOARD_RANGES = [
  'this_month',
  'last_30_days',
  'last_90_days',
  'year_to_date',
] as const;

export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export type DashboardPeriod = {
  key: DashboardRange;
  label: string;
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  groupBy: GroupByUnit;
};

export function resolveDashboardPeriod(
  value?: string,
  now = new Date(),
): DashboardPeriod {
  const range = (value?.trim() || 'this_month') as DashboardRange;

  if (!DASHBOARD_RANGES.includes(range)) {
    throw new BadRequestException(
      `range must be one of: ${DASHBOARD_RANGES.join(', ')}`,
    );
  }

  const end = new Date(now);
  let start: Date;
  let label: string;
  let groupBy: GroupByUnit;

  switch (range) {
    case 'last_30_days':
      start = startOfDay(now);
      start.setDate(start.getDate() - 29);
      label = 'Last 30 days';
      groupBy = 'day';
      break;
    case 'last_90_days':
      start = startOfDay(now);
      start.setDate(start.getDate() - 89);
      label = 'Last 90 days';
      groupBy = 'week';
      break;
    case 'year_to_date':
      start = new Date(now.getFullYear(), 0, 1);
      label = 'Year to date';
      groupBy = 'month';
      break;
    case 'this_month':
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      label = 'This month';
      groupBy = 'day';
      break;
  }

  const duration = end.getTime() - start.getTime();
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - duration);

  return {
    key: range,
    label,
    start,
    end,
    previousStart,
    previousEnd,
    groupBy,
  };
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
