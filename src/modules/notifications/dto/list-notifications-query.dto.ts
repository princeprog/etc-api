export class ListNotificationsQueryDto {
  page?: number | string;
  pageSize?: number | string;
  search?: string;
  category?: string;
  status?: string;
  dateRange?: string;
  unreadOnly?: string | boolean;
  includeResolved?: string | boolean;
}
