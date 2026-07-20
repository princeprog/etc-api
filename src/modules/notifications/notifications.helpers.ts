import type { FollowUpNotificationType } from '../../database/schema';
import {
  daysBetweenDateKeys,
  formatDateKey,
} from '../expenses/expenses.helpers';

export function resolveFollowUpNotificationType(
  dueAt: Date,
  now: Date,
  todayKey: string,
): FollowUpNotificationType | null {
  const dueKey = formatDateKey(dueAt);
  const daysUntilDue = daysBetweenDateKeys(todayKey, dueKey);

  if (dueAt < now) {
    return 'follow_up_overdue';
  }

  if (daysUntilDue === 0) {
    return 'follow_up_due_today';
  }

  if (daysUntilDue <= 7) {
    return 'follow_up_due_soon';
  }

  return null;
}
