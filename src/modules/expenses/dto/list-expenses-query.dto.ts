export class ListExpensesQueryDto {
  page?: number | string;
  pageSize?: number | string;
  search?: string;
  status?: string;
  categoryId?: string;
  frequency?: string;
  assignedStaffId?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: string;
}
