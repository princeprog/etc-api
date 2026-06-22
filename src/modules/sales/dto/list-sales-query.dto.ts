export class ListSalesQueryDto {
  page?: number | string;
  pageSize?: number | string;
  search?: string;
  status?: string;
  agentName?: string;
  dateRange?: string;
  sortBy?: string;
  sortOrder?: string;
}
