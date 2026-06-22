export class ListSellerLeadsQueryDto {
  page?: number | string;
  pageSize?: number | string;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: string;
}
