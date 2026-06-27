import type { CurrentUser } from '../../common/types/auth.types';
import type { JsonObject } from '../../database/db';
import type { ActivityEntityType } from '../../database/schema';

export type ActivityHistoryMetadata = JsonObject;

export interface WriteActivityHistoryInput {
  actor?: CurrentUser | null;
  entityType: ActivityEntityType;
  entityId: string;
  actionType: string;
  summary: string;
  metadata?: ActivityHistoryMetadata;
  createdAt?: Date;
}
