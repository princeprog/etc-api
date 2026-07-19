import { BadRequestException } from '@nestjs/common';

import type {
  ExpenseDisplayStatus,
  ExpenseFrequency,
  ExpenseRuleFrequency,
  ExpenseSettlementStatus,
} from '../../database/schema';

export const EXPENSE_DISPLAY_STATUSES: ExpenseDisplayStatus[] = [
  'upcoming',
  'due_soon',
  'due_today',
  'unpaid',
  'paid',
  'overdue',
  'void',
];

export const EXPENSE_FREQUENCIES: ExpenseFrequency[] = [
  'one_time',
  'weekly',
  'monthly',
  'yearly',
];

export const EXPENSE_RULE_FREQUENCIES: ExpenseRuleFrequency[] = [
  'weekly',
  'monthly',
  'yearly',
];

export const EXPENSE_SETTLEMENT_STATUSES: ExpenseSettlementStatus[] = [
  'unpaid',
  'paid',
  'void',
];

export function getAppTimeZone() {
  return process.env.APP_TIMEZONE?.trim() || 'Asia/Manila';
}

export function requireTrimmed(value: unknown, field: string) {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (!trimmed) {
    throw new BadRequestException(`${field} is required`);
  }

  return trimmed.replace(/\s+/g, ' ');
}

export function normalizeOptionalTrimmed(value: unknown) {
  if (value === null) {
    return null;
  }

  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed.replace(/\s+/g, ' ') : null;
}

export function normalizeMoneyAmount(value: unknown, field: string) {
  const normalized = requireTrimmed(value, field);

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new BadRequestException(`${field} must be a valid monetary amount`);
  }

  return Number(normalized).toFixed(2);
}

export function parseDateOnly(value: unknown, field: string) {
  const normalized = requireTrimmed(value, field);
  const datePart = normalized.includes('T')
    ? normalized.split('T')[0]
    : normalized;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    throw new BadRequestException(`${field} must use YYYY-MM-DD format`);
  }

  const parsed = new Date(`${datePart}T00:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    formatDateKey(parsed, 'UTC') !== datePart
  ) {
    throw new BadRequestException(`${field} must be a valid calendar date`);
  }

  return parsed;
}

export function parseOptionalDateOnly(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return parseDateOnly(value, field);
}

export function parseDateTime(value: unknown, field: string) {
  const normalized = requireTrimmed(value, field);
  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} must be a valid date and time`);
  }

  return parsed;
}

export function parseOptionalDateTime(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') {
    return new Date();
  }

  return parseDateTime(value, field);
}

export function parseBoolean(value: unknown, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return value === true || value === 'true';
}

export function parsePositiveInteger(
  value: unknown,
  fallback: number,
  field: string,
  options: { min?: number; max?: number } = {},
) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : fallback;

  if (!Number.isInteger(parsed)) {
    throw new BadRequestException(`${field} must be a whole number`);
  }

  if (options.min !== undefined && parsed < options.min) {
    throw new BadRequestException(`${field} must be at least ${options.min}`);
  }

  if (options.max !== undefined && parsed > options.max) {
    throw new BadRequestException(`${field} must be at most ${options.max}`);
  }

  return parsed;
}

export function parseExpenseFrequency(
  value: string | undefined,
  fallback: ExpenseFrequency,
): ExpenseFrequency {
  if (!value) {
    return fallback;
  }

  if (!EXPENSE_FREQUENCIES.includes(value as ExpenseFrequency)) {
    throw new BadRequestException(
      'frequency must be one_time, weekly, monthly, or yearly',
    );
  }

  return value as ExpenseFrequency;
}

export function parseExpenseRuleFrequency(
  value: string | undefined,
): ExpenseRuleFrequency {
  if (!EXPENSE_RULE_FREQUENCIES.includes(value as ExpenseRuleFrequency)) {
    throw new BadRequestException(
      'frequency must be weekly, monthly, or yearly',
    );
  }

  return value as ExpenseRuleFrequency;
}

export function parseExpenseSettlementStatus(
  value: string,
): ExpenseSettlementStatus {
  if (!EXPENSE_SETTLEMENT_STATUSES.includes(value as ExpenseSettlementStatus)) {
    throw new BadRequestException(`Unsupported expense status: ${value}`);
  }

  return value as ExpenseSettlementStatus;
}

export function parseExpenseDisplayStatus(value: string) {
  if (!EXPENSE_DISPLAY_STATUSES.includes(value as ExpenseDisplayStatus)) {
    throw new BadRequestException(
      `status must be one of ${EXPENSE_DISPLAY_STATUSES.join(', ')}`,
    );
  }

  return value as ExpenseDisplayStatus;
}

export function resolveExpenseDisplayStatus(input: {
  status: string;
  due_date: Date | string;
}): ExpenseDisplayStatus {
  const settlementStatus = parseExpenseSettlementStatus(input.status);

  if (settlementStatus === 'paid' || settlementStatus === 'void') {
    return settlementStatus;
  }

  const todayKey = getTodayDateKey();
  const dueDateKey = formatDateKey(input.due_date);
  const daysUntilDue = daysBetweenDateKeys(todayKey, dueDateKey);

  if (daysUntilDue < 0) {
    return 'overdue';
  }

  if (daysUntilDue === 0) {
    return 'due_today';
  }

  if (daysUntilDue <= 7) {
    return 'due_soon';
  }

  return 'upcoming';
}

export function getTodayDateKey(now = new Date(), timeZone = getAppTimeZone()) {
  return formatDateKey(now, timeZone);
}

export function formatDateKey(
  value: Date | string,
  timeZone = getAppTimeZone(),
) {
  if (typeof value === 'string') {
    return value.includes('T') ? value.split('T')[0] : value;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Unable to format date');
  }

  return `${year}-${month}-${day}`;
}

export function daysBetweenDateKeys(startKey: string, endKey: string) {
  const start = Date.parse(`${startKey}T00:00:00.000Z`);
  const end = Date.parse(`${endKey}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date, 'UTC');
}

export function moneyToCents(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const [wholePart, decimalPart = ''] = value.split('.');
  return Number(wholePart) * 100 + Number(decimalPart.padEnd(2, '0'));
}

export function centsToMoney(value: number) {
  return (value / 100).toFixed(2);
}
