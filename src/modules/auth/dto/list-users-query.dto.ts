export class ListUsersQueryDto {
  page?: number | string;
  pageSize?: number | string;
  search?: string;
  status?: 'active' | 'disabled' | 'change_password_required';
}
