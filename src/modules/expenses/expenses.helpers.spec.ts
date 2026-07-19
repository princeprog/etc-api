import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  formatDateKey,
  getDaysInMonth,
  getIsoWeekPeriodKey,
  getIsoWeekday,
  resolveExpenseDisplayStatus,
} from './expenses.helpers';

describe('expense helpers', () => {
  beforeEach(() => {
    process.env.APP_TIMEZONE = 'Asia/Manila';
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-19T08:30:00.000+08:00'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('derives paid and void display states from settlement state', () => {
    expect(
      resolveExpenseDisplayStatus({
        status: 'paid',
        due_date: new Date('2026-07-01T00:00:00.000Z'),
      }),
    ).toBe('paid');
    expect(
      resolveExpenseDisplayStatus({
        status: 'void',
        due_date: new Date('2026-07-01T00:00:00.000Z'),
      }),
    ).toBe('void');
  });

  it('derives overdue, due today, due soon, and upcoming states from due date', () => {
    expect(
      resolveExpenseDisplayStatus({
        status: 'unpaid',
        due_date: new Date('2026-07-18T00:00:00.000Z'),
      }),
    ).toBe('overdue');
    expect(
      resolveExpenseDisplayStatus({
        status: 'unpaid',
        due_date: new Date('2026-07-19T00:00:00.000Z'),
      }),
    ).toBe('due_today');
    expect(
      resolveExpenseDisplayStatus({
        status: 'unpaid',
        due_date: new Date('2026-07-26T00:00:00.000Z'),
      }),
    ).toBe('due_soon');
    expect(
      resolveExpenseDisplayStatus({
        status: 'unpaid',
        due_date: new Date('2026-07-27T00:00:00.000Z'),
      }),
    ).toBe('upcoming');
  });

  it('supports Manila date keys and day offsets for recurring windows', () => {
    expect(formatDateKey(new Date('2026-07-18T16:30:00.000Z'))).toBe(
      '2026-07-19',
    );
    expect(addDaysToDateKey('2026-07-19', 7)).toBe('2026-07-26');
    expect(daysBetweenDateKeys('2026-07-19', '2026-07-26')).toBe(7);
  });

  it('supports month-end clamping and weekly period keys', () => {
    expect(getDaysInMonth(2026, 2)).toBe(28);
    expect(getDaysInMonth(2028, 2)).toBe(29);
    expect(getIsoWeekday('2026-07-19')).toBe(7);
    expect(getIsoWeekPeriodKey('2026-07-19')).toBe('2026-W29');
  });
});
