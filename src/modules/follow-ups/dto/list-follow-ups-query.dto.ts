import type { FollowUpStatus, LeadType } from '../../../database/schema';

export type FollowUpStatusFilter = FollowUpStatus | 'DueToday';
export type FollowUpSortKey =
  | 'note'
  | 'leadType'
  | 'leadName'
  | 'dueAt'
  | 'status'
  | 'updatedAt';

export type FollowUpSort = FollowUpSortKey | `-${FollowUpSortKey}`;

export class ListFollowUpsQueryDto {
  status?: FollowUpStatusFilter;
  leadType?: LeadType;
  assigneeUserId?: string;
  dueFrom?: string;
  dueTo?: string;
  search?: string;
  page?: string;
  pageSize?: string;
  sort?: FollowUpSort;
}
