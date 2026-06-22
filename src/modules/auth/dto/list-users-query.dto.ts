export class ListUsersQueryDto {
  search?: string;
  status?: 'active' | 'disabled' | 'change_password_required';
}
