import type { ExpenseNotificationType } from '../../database/schema';

export interface NotificationResponse {
  id: string;
  type: ExpenseNotificationType;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  actionUrl: string | null;
  dueDateSnapshot: Date | null;
  isRead: boolean;
  readAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
