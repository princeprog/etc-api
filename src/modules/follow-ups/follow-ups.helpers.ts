import { BadRequestException } from '@nestjs/common';

import type { FollowUpStatus, LeadType } from '../../database/schema';
import type {
  FollowUpSort,
  FollowUpSortKey,
  FollowUpStatusFilter,
} from './dto/list-follow-ups-query.dto';

const FOLLOW_UP_STATUS_FILTERS: FollowUpStatusFilter[] = [
  'Due',
  'Completed',
  'Overdue',
  'Cancelled',
  'DueToday',
];
const LEAD_TYPES: LeadType[] = ['seller', 'buyer'];

const SORT_KEYS: FollowUpSortKey[] = [
  'note',
  'leadType',
  'leadName',
  'dueAt',
  'status',
  'updatedAt',
];

const FOLLOW_UP_SORTS: FollowUpSort[] = SORT_KEYS.flatMap((key) => [
  key,
  `-${key}` as FollowUpSort,
]);

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_SORT: FollowUpSort = 'dueAt';

/**
 * Follow-up status is DERIVED, never stored as `Overdue`. The `status` column
 * only ever holds `Due`, `Completed`, or `Cancelled`. Effective status for a row is:
 *   - `Cancelled` -> cancelled_at IS NOT NULL
 *   - `Completed` -> completed_at IS NOT NULL
 *   - `Overdue`   -> no terminal timestamp AND due_at <  now
 *   - `Due`       -> no terminal timestamp AND due_at >= now
 *
 * Summary sub-buckets (all exclude completed and cancelled rows):
 *   - dueToday  -> due_at within [todayStart, tomorrowStart)
 *   - upcoming  -> due_at within (now, now + 7 days]
 *   - overdue   -> due_at < now
 *   - completed -> completed_at IS NOT NULL
 */
export function deriveFollowUpStatus(
  completedAt: Date | null,
  cancelledAt: Date | null,
  dueAt: Date,
  now = new Date(),
): FollowUpStatus {
  if (cancelledAt) {
    return 'Cancelled';
  }

  if (completedAt) {
    return 'Completed';
  }

  return dueAt < now ? 'Overdue' : 'Due';
}

export function parseFollowUpStatus(
  value: string | undefined,
): FollowUpStatusFilter | undefined {
  if (!value) {
    return undefined;
  }

  if (!FOLLOW_UP_STATUS_FILTERS.includes(value as FollowUpStatusFilter)) {
    throw new BadRequestException(`Unsupported follow-up status: ${value}`);
  }

  return value as FollowUpStatusFilter;
}

export function parseLeadType(value: string): LeadType {
  if (!LEAD_TYPES.includes(value as LeadType)) {
    throw new BadRequestException(`Unsupported lead type: ${value}`);
  }

  return value as LeadType;
}

export function parseOptionalLeadType(
  value: string | undefined,
): LeadType | undefined {
  if (!value) {
    return undefined;
  }

  return parseLeadType(value);
}

export function parseSort(value: string | undefined): FollowUpSort {
  if (!value) {
    return DEFAULT_SORT;
  }

  if (!FOLLOW_UP_SORTS.includes(value as FollowUpSort)) {
    throw new BadRequestException(`Unsupported sort: ${value}`);
  }

  return value as FollowUpSort;
}

export function parsePageNumber(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException(`Invalid pagination value: ${value}`);
  }

  return parsed;
}

export function resolvePageSize(value: string | undefined): number {
  const parsed = parsePageNumber(value, DEFAULT_PAGE_SIZE);
  return Math.min(parsed, MAX_PAGE_SIZE);
}

export function parseDueDate(
  value: string | undefined,
  field: string,
): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid ${field} value: ${value}`);
  }

  return parsed;
}

export function mapFollowUpResponse(followUp: {
  id: string;
  lead_type: LeadType;
  seller_lead_id: string | null;
  buyer_lead_id: string | null;
  assignee_user_id: string;
  due_at: Date;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  status: FollowUpStatus;
  note: string;
  outcome_note: string | null;
  created_at: Date;
  updated_at: Date;
  lead_name?: string | null;
  lead_secondary?: string | null;
  assignee?: {
    id: string;
    fullName: string;
    email: string;
    roleName: string;
  } | null;
}) {
  return {
    id: followUp.id,
    leadType: followUp.lead_type,
    sellerLeadId: followUp.seller_lead_id,
    buyerLeadId: followUp.buyer_lead_id,
    assigneeUserId: followUp.assignee_user_id,
    dueAt: followUp.due_at,
    completedAt: followUp.completed_at,
    cancelledAt: followUp.cancelled_at,
    cancellationReason: followUp.cancellation_reason,
    status: followUp.status,
    note: followUp.note,
    outcomeNote: followUp.outcome_note,
    leadName: followUp.lead_name ?? null,
    leadSecondary: followUp.lead_secondary ?? null,
    assignee: followUp.assignee ?? null,
    createdAt: followUp.created_at,
    updatedAt: followUp.updated_at,
  };
}
