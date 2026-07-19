import { BadRequestException } from '@nestjs/common';

import { resolveDashboardPeriod } from './dashboard-period';

describe('DashboardService reporting periods', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-19T10:30:00+08:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ['this_month', 'This month', 'day'],
    ['last_30_days', 'Last 30 days', 'day'],
    ['last_90_days', 'Last 90 days', 'week'],
    ['year_to_date', 'Year to date', 'month'],
  ] as const)(
    'resolves %s with its label and chart grouping',
    (key, label, groupBy) => {
      const period = resolveDashboardPeriod(key);

      expect(period).toEqual(expect.objectContaining({ key, label, groupBy }));
      expect(period.end).toEqual(new Date('2026-07-19T10:30:00+08:00'));
      expect(period.previousEnd.getTime()).toBe(period.start.getTime() - 1);
      expect(period.previousStart.getTime()).toBeLessThan(
        period.previousEnd.getTime(),
      );
    },
  );

  it('uses the current month when no range is supplied', () => {
    const period = resolveDashboardPeriod();

    expect(period.key).toBe('this_month');
    expect(period.start.getFullYear()).toBe(2026);
    expect(period.start.getMonth()).toBe(6);
    expect(period.start.getDate()).toBe(1);
    expect(period.start.getHours()).toBe(0);
  });

  it('uses inclusive rolling-day boundaries for 30 and 90 day ranges', () => {
    const thirtyDays = resolveDashboardPeriod('last_30_days');
    const ninetyDays = resolveDashboardPeriod('last_90_days');

    expect(thirtyDays.start.getFullYear()).toBe(2026);
    expect(thirtyDays.start.getMonth()).toBe(5);
    expect(thirtyDays.start.getDate()).toBe(20);
    expect(ninetyDays.start.getFullYear()).toBe(2026);
    expect(ninetyDays.start.getMonth()).toBe(3);
    expect(ninetyDays.start.getDate()).toBe(21);
  });

  it('starts year-to-date on January 1 in the server timezone', () => {
    const period = resolveDashboardPeriod('year_to_date');

    expect(period.start.getFullYear()).toBe(2026);
    expect(period.start.getMonth()).toBe(0);
    expect(period.start.getDate()).toBe(1);
    expect(period.start.getHours()).toBe(0);
  });

  it('rejects unsupported range keys with a client-safe error', () => {
    expect(() => resolveDashboardPeriod('last_week')).toThrow(
      BadRequestException,
    );
  });
});
