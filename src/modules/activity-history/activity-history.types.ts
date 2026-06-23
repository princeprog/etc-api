import type { CurrentUser } from '../../common/types/auth.types';
import type { ActivityEntityType } from '../../database/schema';

export interface ActivityHistoryMetadata {
  [key: string]: unknown;
}

export interface WriteActivityHistoryInput {
  actor?: CurrentUser | null;
  entityType: ActivityEntityType;
  entityId: string;
  actionType: string;
  summary: string;
  metadata?: ActivityHistoryMetadata;
  createdAt?: Date;
}
