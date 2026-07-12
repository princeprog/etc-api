export class ListSellerLeadsQueryDto {
  page?: number | string;
  pageSize?: number | string;
  search?: string;
  status?: string;
  pipelineState?: string;
  sortBy?: string;
  sortOrder?: string;
}
