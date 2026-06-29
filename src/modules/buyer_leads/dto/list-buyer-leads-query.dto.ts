export class ListBuyerLeadsQueryDto {
  page?: number | string;
  pageSize?: number | string;
  search?: string;
  status?: string;
  eligibleForSale?: boolean | string;
  pipelineState?: string;
  sortBy?: string;
  sortOrder?: string;
}
