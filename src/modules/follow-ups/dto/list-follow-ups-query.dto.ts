export class ListFollowUpsQueryDto {
  page?: number | string;
  pageSize?: number | string;
  search?: string;
  status?: string;
  leadType?: string;
  assigneeUserId?: string;
  sortBy?: string;
  sortOrder?: string;
}
