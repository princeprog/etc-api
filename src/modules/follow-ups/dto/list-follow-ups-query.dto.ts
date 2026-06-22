import type { FollowUpStatus, LeadType } from '../../../database/schema';

export type FollowUpSort = 'dueAt' | '-dueAt' | 'updatedAt' | '-updatedAt';

export class ListFollowUpsQueryDto {
  status?: FollowUpStatus;
  leadType?: LeadType;
  assigneeUserId?: string;
  dueFrom?: string;
  dueTo?: string;
  search?: string;
  page?: string;
  pageSize?: string;
  sort?: FollowUpSort;
}
