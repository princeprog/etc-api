export class ListNotificationsQueryDto {
  page?: number | string;
  pageSize?: number | string;
  unreadOnly?: string | boolean;
  includeResolved?: string | boolean;
}
