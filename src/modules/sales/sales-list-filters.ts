import { BadRequestException } from '@nestjs/common';
import type { SelectQueryBuilder } from 'kysely';
import { sql } from 'kysely';

import { normalizeSearch } from '../../common/utils/list-query.utils';
import type { DB } from '../../database/db';
import type { ListSalesQueryDto } from './dto/list-sales-query.dto';
import { normalizeOptionalTrimmed } from './sales.helpers';

export type SalesFilterStatus =
  | 'all'
  | 'draft'
  | 'finalized'
  | 'commission_locked'
  | 'needs_review'
  | 'none';

export type SalesFilterDateRange = 'all' | 'this_month' | 'last_30_days';
export type SalesFilterSortBy =
  | 'saleDate'
  | 'createdAt'
  | 'finalSaleAmount'
  | 'saleNumber'
  | 'agentName';
export type SalesFilterSortOrder = 'asc' | 'desc';

export type NormalizedSalesListFilters = {
  search?: string;
  agentName?: string;
  status: SalesFilterStatus;
  dateRange: SalesFilterDateRange;
  sortBy: SalesFilterSortBy;
  sortOrder: SalesFilterSortOrder;
};

export type SaleListRecord = {
  id: string;
  recordType: 'sale' | 'draft';
  recordNumber: string;
  agentName: string | null;
  finalSaleAmount: string | null;
  sortDate: Date;
  createdAt: Date;
};

type SalesQueryBuilder = SelectQueryBuilder<
  DB,
  | 'sales.sales'
  | 'inventory.vehicles'
  | 'crm.buyer_leads'
  | 'sales.commissions',
  object
>;

type DraftsQueryBuilder = SelectQueryBuilder<
  DB,
  'sales.sale_drafts' | 'inventory.vehicles' | 'crm.buyer_leads',
  object
>;

export function normalizeSalesListFilters(
  query: ListSalesQueryDto = {},
): NormalizedSalesListFilters {
  return {
    search: normalizeSearch(query.search),
    agentName: normalizeOptionalTrimmed(query.agentName) ?? undefined,
    status: normalizeStatus(query.status),
    dateRange: normalizeDateRange(query.dateRange),
    sortBy: normalizeSortBy(query.sortBy),
    sortOrder: normalizeSortOrder(query.sortOrder),
  };
}

export function shouldIncludeSales(filters: NormalizedSalesListFilters) {
  return filters.status !== 'draft';
}

export function shouldIncludeDrafts(filters: NormalizedSalesListFilters) {
  return filters.status === 'all' || filters.status === 'draft';
}

export function compareSalesListRecords(
  left: SaleListRecord,
  right: SaleListRecord,
  filters: NormalizedSalesListFilters,
) {
  const multiplier = filters.sortOrder === 'asc' ? 1 : -1;
  const compared = compareRecordValue(left, right, filters.sortBy);

  return compared * multiplier || left.id.localeCompare(right.id) * multiplier;
}

function compareRecordValue(
  left: SaleListRecord,
  right: SaleListRecord,
  sortBy: SalesFilterSortBy,
) {
  switch (sortBy) {
    case 'createdAt':
      return left.createdAt.getTime() - right.createdAt.getTime();
    case 'finalSaleAmount':
      return (
        Number(left.finalSaleAmount ?? 0) - Number(right.finalSaleAmount ?? 0)
      );
    case 'saleNumber':
      return left.recordNumber.localeCompare(right.recordNumber);
    case 'agentName':
      return (left.agentName ?? '').localeCompare(right.agentName ?? '');
    case 'saleDate':
      return left.sortDate.getTime() - right.sortDate.getTime();
  }
}

export function applySalesListFilters(
  query: SalesQueryBuilder,
  filters: NormalizedSalesListFilters,
) {
  let salesQuery = query;

  if (filters.search) {
    const pattern = `%${filters.search.toLowerCase()}%`;
    salesQuery = salesQuery.where((eb) =>
      eb.or([
        eb(sql<string>`lower(sales.sales.sale_number)`, 'like', pattern),
        eb(sql<string>`lower(sales.sales.id::text)`, 'like', pattern),
        eb(
          sql<string>`lower(inventory.vehicles.stock_number)`,
          'like',
          pattern,
        ),
        eb(sql<string>`lower(inventory.vehicles.brand)`, 'like', pattern),
        eb(sql<string>`lower(inventory.vehicles.model)`, 'like', pattern),
        eb(
          sql<string>`lower(coalesce(sales.sales.agent_name, ''))`,
          'like',
          pattern,
        ),
        eb(sql<string>`lower(crm.buyer_leads.buyer_name)`, 'like', pattern),
        eb(sql<string>`lower(crm.buyer_leads.contact_number)`, 'like', pattern),
      ]),
    );
  }

  if (filters.agentName) {
    salesQuery = salesQuery.where(
      sql<boolean>`lower(coalesce(sales.sales.agent_name, '')) = lower(${filters.agentName})`,
    );
  }

  salesQuery = applySalesStatusFilter(salesQuery, filters.status);
  salesQuery = applySalesDateRangeFilter(salesQuery, filters.dateRange);

  return salesQuery;
}

export function applyDraftListFilters(
  query: DraftsQueryBuilder,
  filters: NormalizedSalesListFilters,
) {
  let draftsQuery = query;

  if (filters.search) {
    const pattern = `%${filters.search.toLowerCase()}%`;
    draftsQuery = draftsQuery.where((eb) =>
      eb.or([
        eb(sql<string>`lower(sales.sale_drafts.draft_number)`, 'like', pattern),
        eb(sql<string>`lower(sales.sale_drafts.id::text)`, 'like', pattern),
        eb(
          sql<string>`lower(inventory.vehicles.stock_number)`,
          'like',
          pattern,
        ),
        eb(sql<string>`lower(inventory.vehicles.brand)`, 'like', pattern),
        eb(sql<string>`lower(inventory.vehicles.model)`, 'like', pattern),
        eb(
          sql<string>`lower(coalesce(sales.sale_drafts.agent_name, ''))`,
          'like',
          pattern,
        ),
        eb(sql<string>`lower(crm.buyer_leads.buyer_name)`, 'like', pattern),
        eb(sql<string>`lower(crm.buyer_leads.contact_number)`, 'like', pattern),
      ]),
    );
  }

  if (filters.agentName) {
    draftsQuery = draftsQuery.where(
      sql<boolean>`lower(coalesce(sales.sale_drafts.agent_name, '')) = lower(${filters.agentName})`,
    );
  }

  draftsQuery = applyDraftDateRangeFilter(draftsQuery, filters.dateRange);

  return draftsQuery;
}

function applySalesStatusFilter(
  query: SalesQueryBuilder,
  status: SalesFilterStatus,
) {
  switch (status) {
    case 'all':
    case 'draft':
      return query;
    case 'none':
      return query.where(sql<boolean>`false`);
    case 'finalized':
      return query
        .where('sales.sales.commission_locked', '=', true)
        .where('sales.commissions.override_amount', 'is', null);
    case 'commission_locked':
      return query
        .where('sales.sales.commission_locked', '=', true)
        .where('sales.commissions.override_amount', 'is not', null);
    case 'needs_review':
      return query.where('sales.sales.commission_locked', '=', false);
  }
}

function applySalesDateRangeFilter(
  query: SalesQueryBuilder,
  dateRange: SalesFilterDateRange,
) {
  const now = new Date();

  switch (dateRange) {
    case 'all':
      return query;
    case 'this_month':
      return query.where(
        sql<boolean>`date_trunc('month', sales.sales.sale_date) = date_trunc('month', ${now}::timestamptz)`,
      );
    case 'last_30_days':
      return query.where(
        'sales.sales.sale_date',
        '>=',
        new Date(now.getTime() - 30 * 86_400_000),
      );
  }
}

function applyDraftDateRangeFilter(
  query: DraftsQueryBuilder,
  dateRange: SalesFilterDateRange,
) {
  const now = new Date();

  switch (dateRange) {
    case 'all':
      return query;
    case 'this_month':
      return query.where(
        sql<boolean>`date_trunc('month', coalesce(sales.sale_drafts.sale_date, sales.sale_drafts.updated_at)) = date_trunc('month', ${now}::timestamptz)`,
      );
    case 'last_30_days':
      return query.where(
        sql<boolean>`coalesce(sales.sale_drafts.sale_date, sales.sale_drafts.updated_at) >= ${new Date(
          now.getTime() - 30 * 86_400_000,
        )}`,
      );
  }
}

function normalizeStatus(status?: string): SalesFilterStatus {
  switch (status) {
    case undefined:
    case '':
    case 'all':
      return 'all';
    case 'draft':
    case 'finalized':
    case 'commission_locked':
    case 'needs_review':
    case 'none':
      return status;
    default:
      throw new BadRequestException(`Unsupported sales status: ${status}`);
  }
}

function normalizeDateRange(dateRange?: string): SalesFilterDateRange {
  switch (dateRange) {
    case undefined:
    case '':
    case 'all':
      return 'all';
    case 'this_month':
    case 'last_30_days':
      return dateRange;
    default:
      throw new BadRequestException(
        `Unsupported sales date range: ${dateRange}`,
      );
  }
}

function normalizeSortBy(sortBy?: string): SalesFilterSortBy {
  switch (sortBy) {
    case undefined:
    case '':
    case 'saleDate':
      return 'saleDate';
    case 'createdAt':
    case 'finalSaleAmount':
    case 'saleNumber':
    case 'agentName':
      return sortBy;
    default:
      throw new BadRequestException(`Unsupported sales sort: ${sortBy}`);
  }
}

function normalizeSortOrder(sortOrder?: string): SalesFilterSortOrder {
  switch (sortOrder) {
    case undefined:
    case '':
    case 'desc':
      return 'desc';
    case 'asc':
      return 'asc';
    default:
      throw new BadRequestException(`Unsupported sort order: ${sortOrder}`);
  }
}
