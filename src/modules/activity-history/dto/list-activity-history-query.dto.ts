export class ListActivityHistoryQueryDto {
  page?: number | string;
  pageSize?: number | string;
  limit?: number | string;
  search?: string;
  entityType?: string;
  actionType?: string;
  actor?: string;
  actorUserId?: string;
  dateRange?: string;
}
