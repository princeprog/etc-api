import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';

import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { ReportExportQueryDto, ReportQueryDto } from './dto/report-query.dto';
import {
  averageMoney,
  buildCsv,
  buildExportFilename,
  formatPeriodLabel,
  GroupByUnit,
  normalizeMoney,
  normalizeOptionalText,
  resolveDateRange,
  resolveGroupBy,
  ResolvedDateRange,
  toPercentage,
} from './reports.helpers';

/**
 * ReportsService is the single source of truth for internal business reporting.
 *
 * Every metric definition lives here so the JSON the UI renders and the CSV
 * staff export are computed from the exact same filtered, server-side
 * aggregation. Reports favor set-based SQL (GROUP BY / COUNT / SUM / FILTER)
 * over in-memory reduction to stay efficient for operational use.
 *
 * Business definitions & exclusions:
 * - Revenue        = SUM(sales.final_sale_amount) over sales whose sale_date is
 *                    inside the range.
 * - Gross profit   = SUM(sales.gross_profit_amount). This is NULL when the sold
 *                    vehicle had no recorded purchase price, so such sales are
 *                    excluded from profit sums but surfaced via `salesMissingCost`.
 * - Commission     = SUM(commissions.final_amount) for the matching sales.
 * - Gross margin % = gross profit / revenue * 100.
 * - Sales/profit reports filter on `sale_date`; lead reports filter on the
 *   lead's `created_at`. Inventory is a CURRENT snapshot and is intentionally
 *   not date-filtered (status is point-in-time) — see `basis` in the response.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  // ---------------------------------------------------------------------------
  // Overview — top-level cross-domain snapshot for the reporting landing view.
  // ---------------------------------------------------------------------------
  async getOverview(query: ReportQueryDto) {
    const range = resolveDateRange(query);
    const agentName = normalizeOptionalText(query.agentName);

    const [sales, inventory, leads] = await Promise.all([
      this.computeSalesSummary(range, agentName),
      this.computeInventorySnapshot(),
      this.computeLeadsConversion(range),
    ]);

    return {
      dateRange: this.describeRange(range),
      sales,
      inventory: {
        totalUnits: inventory.totalUnits,
        activeUnits: inventory.activeUnits,
        available: inventory.byStatusMap.Available ?? 0,
        reserved: inventory.byStatusMap.Reserved ?? 0,
        sold: inventory.byStatusMap.Sold ?? 0,
        totalInventoryValue: inventory.totalInventoryValue,
      },
      leads,
      profitability: {
        totalGrossProfit: sales.totalGrossProfit,
        grossMarginPercent: sales.grossMarginPercent,
        averageGrossProfitPerSale: averageMoney(
          sales.totalGrossProfit,
          sales.salesWithKnownCost,
        ),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Sales reporting
  // ---------------------------------------------------------------------------
  async getSalesReport(query: ReportQueryDto) {
    const range = resolveDateRange(query);
    const groupBy = resolveGroupBy(query.groupBy);
    const agentName = normalizeOptionalText(query.agentName);

    const [summary, trend, byAgent] = await Promise.all([
      this.computeSalesSummary(range, agentName),
      this.computeSalesTrend(range, groupBy, agentName),
      this.computeSalesByAgent(range),
    ]);

    return {
      filters: {
        ...this.describeRange(range),
        groupBy,
        agentName: agentName ?? null,
      },
      summary,
      trend,
      byAgent,
    };
  }

  // ---------------------------------------------------------------------------
  // Inventory reporting (current snapshot)
  // ---------------------------------------------------------------------------
  async getInventoryReport(query: ReportQueryDto) {
    const status = normalizeOptionalText(query.status);

    const [snapshot, aging, byBrand] = await Promise.all([
      this.computeInventorySnapshot(),
      this.computeInventoryAging(),
      this.computeInventoryByBrand(status),
    ]);

    const byStatus = snapshot.byStatus.map((row) => ({
      ...row,
      percentage: toPercentage(row.count, snapshot.totalUnits),
    }));

    return {
      basis:
        'Current inventory snapshot — vehicle status is point-in-time and not date-filtered.',
      summary: {
        totalUnits: snapshot.totalUnits,
        activeUnits: snapshot.activeUnits,
        available: snapshot.byStatusMap.Available ?? 0,
        reserved: snapshot.byStatusMap.Reserved ?? 0,
        sold: snapshot.byStatusMap.Sold ?? 0,
        incoming: snapshot.byStatusMap.Incoming ?? 0,
        reconditioning: snapshot.byStatusMap.Reconditioning ?? 0,
        totalInventoryValue: snapshot.totalInventoryValue,
        soldVsAvailable: {
          sold: snapshot.byStatusMap.Sold ?? 0,
          available: snapshot.byStatusMap.Available ?? 0,
        },
      },
      byStatus,
      aging,
      byBrand,
    };
  }

  // ---------------------------------------------------------------------------
  // Lead conversion / pipeline reporting
  // ---------------------------------------------------------------------------
  async getLeadsReport(query: ReportQueryDto) {
    const range = resolveDateRange(query);

    const [buyerByStatus, sellerByStatus, conversion] = await Promise.all([
      this.computeBuyerLeadsByStatus(range),
      this.computeSellerLeadsByStatus(range),
      this.computeLeadsConversion(range),
    ]);

    return {
      dateRange: this.describeRange(range),
      basis:
        'Leads are counted by their creation date within the selected range.',
      buyer: {
        total: buyerByStatus.reduce((sum, row) => sum + row.count, 0),
        byStatus: buyerByStatus,
      },
      seller: {
        total: sellerByStatus.reduce((sum, row) => sum + row.count, 0),
        byStatus: sellerByStatus,
      },
      conversion,
    };
  }

  // ---------------------------------------------------------------------------
  // Profitability reporting
  // ---------------------------------------------------------------------------
  async getProfitabilityReport(query: ReportQueryDto) {
    const range = resolveDateRange(query);
    const groupBy = resolveGroupBy(query.groupBy);
    const agentName = normalizeOptionalText(query.agentName);

    const [summary, trend, byAgent] = await Promise.all([
      this.computeSalesSummary(range, agentName),
      this.computeProfitabilityTrend(range, groupBy, agentName),
      this.computeSalesByAgent(range),
    ]);

    return {
      filters: {
        ...this.describeRange(range),
        groupBy,
        agentName: agentName ?? null,
      },
      summary: {
        totalRevenue: summary.totalRevenue,
        totalGrossProfit: summary.totalGrossProfit,
        grossMarginPercent: summary.grossMarginPercent,
        averageGrossProfitPerSale: averageMoney(
          summary.totalGrossProfit,
          summary.salesWithKnownCost,
        ),
        salesWithKnownCost: summary.salesWithKnownCost,
        salesMissingCost: summary.salesMissingCost,
      },
      trend,
      byAgent,
    };
  }

  // ---------------------------------------------------------------------------
  // Exports — reuse the exact same computations, emit business-readable CSV.
  // ---------------------------------------------------------------------------
  async exportReport(domain: string, query: ReportExportQueryDto) {
    switch (domain) {
      case 'sales':
        return this.exportSales(query);
      case 'inventory':
        return this.exportInventory(query);
      case 'leads':
        return this.exportLeads(query);
      case 'profitability':
        return this.exportProfitability(query);
      default:
        throw new BadRequestException(`Unsupported report domain: ${domain}`);
    }
  }

  private async exportSales(query: ReportExportQueryDto) {
    const dataset = query.dataset ?? 'trend';
    const report = await this.getSalesReport(query);

    if (dataset === 'by-agent') {
      return {
        filename: buildExportFilename('sales', 'by-agent'),
        csv: buildCsv(
          [
            {
              header: 'Agent',
              value: (row: (typeof report.byAgent)[number]) => row.agentName,
            },
            { header: 'Sales Count', value: (row) => row.salesCount },
            { header: 'Revenue', value: (row) => row.revenue },
            { header: 'Gross Profit', value: (row) => row.grossProfit },
            {
              header: 'Commission Payouts',
              value: (row) => row.commissionPayouts,
            },
            {
              header: 'Average Sale Value',
              value: (row) => row.averageSaleValue,
            },
          ],
          report.byAgent,
        ),
      };
    }

    if (dataset === 'trend') {
      return {
        filename: buildExportFilename(
          'sales',
          `trend-${report.filters.groupBy}`,
        ),
        csv: buildCsv(
          [
            {
              header: 'Period',
              value: (row: (typeof report.trend)[number]) => row.periodLabel,
            },
            { header: 'Sales Count', value: (row) => row.salesCount },
            { header: 'Revenue', value: (row) => row.revenue },
            { header: 'Gross Profit', value: (row) => row.grossProfit },
            {
              header: 'Commission Payouts',
              value: (row) => row.commissionPayouts,
            },
          ],
          report.trend,
        ),
      };
    }

    throw new BadRequestException(
      `Unsupported sales export dataset: ${dataset} (expected "trend" or "by-agent")`,
    );
  }

  private async exportInventory(query: ReportExportQueryDto) {
    const dataset = query.dataset ?? 'by-status';
    const report = await this.getInventoryReport(query);

    if (dataset === 'by-status') {
      return {
        filename: buildExportFilename('inventory', 'by-status'),
        csv: buildCsv(
          [
            {
              header: 'Status',
              value: (row: (typeof report.byStatus)[number]) => row.status,
            },
            { header: 'Vehicle Count', value: (row) => row.count },
            { header: 'Share %', value: (row) => row.percentage },
          ],
          report.byStatus,
        ),
      };
    }

    if (dataset === 'aging') {
      return {
        filename: buildExportFilename('inventory', 'aging'),
        csv: buildCsv(
          [
            {
              header: 'Inventory Age',
              value: (row: (typeof report.aging)[number]) => row.bucket,
            },
            { header: 'Vehicle Count', value: (row) => row.count },
          ],
          report.aging,
        ),
      };
    }

    if (dataset === 'by-brand') {
      return {
        filename: buildExportFilename('inventory', 'by-brand'),
        csv: buildCsv(
          [
            {
              header: 'Brand',
              value: (row: (typeof report.byBrand)[number]) => row.brand,
            },
            { header: 'Total Units', value: (row) => row.total },
            { header: 'Available', value: (row) => row.available },
            { header: 'Reserved', value: (row) => row.reserved },
            { header: 'Sold', value: (row) => row.sold },
          ],
          report.byBrand,
        ),
      };
    }

    throw new BadRequestException(
      `Unsupported inventory export dataset: ${dataset} (expected "by-status", "aging" or "by-brand")`,
    );
  }

  private async exportLeads(query: ReportExportQueryDto) {
    const dataset = query.dataset ?? 'buyer';
    const report = await this.getLeadsReport(query);

    if (dataset === 'buyer' || dataset === 'seller') {
      const source = dataset === 'buyer' ? report.buyer : report.seller;
      return {
        filename: buildExportFilename('leads', `${dataset}-pipeline`),
        csv: buildCsv(
          [
            {
              header: 'Status',
              value: (row: (typeof source.byStatus)[number]) => row.status,
            },
            { header: 'Lead Count', value: (row) => row.count },
          ],
          source.byStatus,
        ),
      };
    }

    throw new BadRequestException(
      `Unsupported leads export dataset: ${dataset} (expected "buyer" or "seller")`,
    );
  }

  private async exportProfitability(query: ReportExportQueryDto) {
    const dataset = query.dataset ?? 'trend';
    const report = await this.getProfitabilityReport(query);

    if (dataset === 'trend') {
      return {
        filename: buildExportFilename(
          'profitability',
          `trend-${report.filters.groupBy}`,
        ),
        csv: buildCsv(
          [
            {
              header: 'Period',
              value: (row: (typeof report.trend)[number]) => row.periodLabel,
            },
            { header: 'Revenue', value: (row) => row.revenue },
            { header: 'Gross Profit', value: (row) => row.grossProfit },
            {
              header: 'Gross Margin %',
              value: (row) => row.grossMarginPercent,
            },
          ],
          report.trend,
        ),
      };
    }

    if (dataset === 'by-agent') {
      return {
        filename: buildExportFilename('profitability', 'by-agent'),
        csv: buildCsv(
          [
            {
              header: 'Agent',
              value: (row: (typeof report.byAgent)[number]) => row.agentName,
            },
            { header: 'Sales Count', value: (row) => row.salesCount },
            { header: 'Revenue', value: (row) => row.revenue },
            { header: 'Gross Profit', value: (row) => row.grossProfit },
            {
              header: 'Gross Margin %',
              value: (row) => row.grossMarginPercent,
            },
          ],
          report.byAgent,
        ),
      };
    }

    throw new BadRequestException(
      `Unsupported profitability export dataset: ${dataset} (expected "trend" or "by-agent")`,
    );
  }

  // ===========================================================================
  // Internal computations (shared metric definitions)
  // ===========================================================================

  // Commission payouts are always summed in a separate query (commissions →
  // sales) so the strict 1:1 commission relationship can never fan out the
  // revenue/profit aggregates computed off the sales table.

  private async computeSalesSummary(
    range: ResolvedDateRange,
    agentName?: string,
  ) {
    let salesQuery = this.db.selectFrom('sales.sales');

    if (range.start) {
      salesQuery = salesQuery.where('sales.sales.sale_date', '>=', range.start);
    }

    if (range.end) {
      salesQuery = salesQuery.where('sales.sales.sale_date', '<=', range.end);
    }

    if (agentName) {
      salesQuery = salesQuery.where(
        sql<boolean>`lower(coalesce(sales.sales.agent_name, '')) = lower(${agentName})`,
      );
    }

    const summary = await salesQuery
      .select(({ fn }) => [
        fn.count<string>('sales.sales.id').as('totalSales'),
        sql<string>`coalesce(sum(sales.sales.final_sale_amount::numeric), 0)::text`.as(
          'totalRevenue',
        ),
        sql<string>`coalesce(sum(sales.sales.gross_profit_amount::numeric), 0)::text`.as(
          'totalGrossProfit',
        ),
        sql<string>`count(*) filter (where sales.sales.gross_profit_amount is not null)`.as(
          'salesWithKnownCost',
        ),
        sql<string>`count(*) filter (where sales.sales.gross_profit_amount is null)`.as(
          'salesMissingCost',
        ),
      ])
      .executeTakeFirstOrThrow();

    const commissionRow = await this.db
      .selectFrom('sales.commissions')
      .innerJoin('sales.sales', 'sales.sales.id', 'sales.commissions.sale_id')
      .$if(Boolean(range.start), (qb) =>
        qb.where('sales.sales.sale_date', '>=', range.start as Date),
      )
      .$if(Boolean(range.end), (qb) =>
        qb.where('sales.sales.sale_date', '<=', range.end as Date),
      )
      .$if(Boolean(agentName), (qb) =>
        qb.where(
          sql<boolean>`lower(coalesce(sales.sales.agent_name, '')) = lower(${agentName})`,
        ),
      )
      .select(
        sql<string>`coalesce(sum(sales.commissions.final_amount::numeric), 0)::text`.as(
          'totalCommissionPayouts',
        ),
      )
      .executeTakeFirstOrThrow();

    const totalSales = Number(summary.totalSales);
    const totalRevenue = normalizeMoney(summary.totalRevenue);
    const totalGrossProfit = normalizeMoney(summary.totalGrossProfit);

    return {
      totalSales,
      totalRevenue,
      totalGrossProfit,
      totalCommissionPayouts: normalizeMoney(
        commissionRow.totalCommissionPayouts,
      ),
      averageSaleValue: averageMoney(totalRevenue, totalSales),
      grossMarginPercent: toPercentage(
        Number(totalGrossProfit),
        Number(totalRevenue),
      ),
      salesWithKnownCost: Number(summary.salesWithKnownCost),
      salesMissingCost: Number(summary.salesMissingCost),
    };
  }

  private async computeSalesTrend(
    range: ResolvedDateRange,
    groupBy: GroupByUnit,
    agentName?: string,
  ) {
    // `groupBy` is validated to day|week|month, so inline it as a SQL literal.
    // A bound parameter would render as distinct placeholders in SELECT vs
    // GROUP BY and Postgres would fail to match the grouped expression.
    const period = sql<string>`to_char(date_trunc(${sql.lit(groupBy)}, sales.sales.sale_date), 'YYYY-MM-DD')`;
    const commissionPeriod = sql<string>`to_char(date_trunc(${sql.lit(groupBy)}, sales.sales.sale_date), 'YYYY-MM-DD')`;

    let salesQuery = this.db.selectFrom('sales.sales');

    if (range.start) {
      salesQuery = salesQuery.where('sales.sales.sale_date', '>=', range.start);
    }

    if (range.end) {
      salesQuery = salesQuery.where('sales.sales.sale_date', '<=', range.end);
    }

    if (agentName) {
      salesQuery = salesQuery.where(
        sql<boolean>`lower(coalesce(sales.sales.agent_name, '')) = lower(${agentName})`,
      );
    }

    const salesRows = await salesQuery
      .select(() => [
        period.as('period'),
        sql<string>`count(*)`.as('salesCount'),
        sql<string>`coalesce(sum(sales.sales.final_sale_amount::numeric), 0)::text`.as(
          'revenue',
        ),
        sql<string>`coalesce(sum(sales.sales.gross_profit_amount::numeric), 0)::text`.as(
          'grossProfit',
        ),
      ])
      .groupBy(period)
      .orderBy(period)
      .execute();

    // Commission payouts summed separately (commissions → sales) and merged by
    // period so the 1:1 join can never inflate revenue/profit above.
    let commissionQuery = this.db
      .selectFrom('sales.commissions')
      .innerJoin('sales.sales', 'sales.sales.id', 'sales.commissions.sale_id');

    if (range.start) {
      commissionQuery = commissionQuery.where(
        'sales.sales.sale_date',
        '>=',
        range.start,
      );
    }

    if (range.end) {
      commissionQuery = commissionQuery.where(
        'sales.sales.sale_date',
        '<=',
        range.end,
      );
    }

    if (agentName) {
      commissionQuery = commissionQuery.where(
        sql<boolean>`lower(coalesce(sales.sales.agent_name, '')) = lower(${agentName})`,
      );
    }

    const commissionRows = await commissionQuery
      .select(() => [
        commissionPeriod.as('period'),
        sql<string>`coalesce(sum(sales.commissions.final_amount::numeric), 0)::text`.as(
          'commissionPayouts',
        ),
      ])
      .groupBy(commissionPeriod)
      .execute();

    const commissionByPeriod = new Map(
      commissionRows.map((row) => [row.period, row.commissionPayouts]),
    );

    return salesRows.map((row) => ({
      period: row.period,
      periodLabel: formatPeriodLabel(row.period, groupBy),
      salesCount: Number(row.salesCount),
      revenue: normalizeMoney(row.revenue),
      grossProfit: normalizeMoney(row.grossProfit),
      commissionPayouts: normalizeMoney(
        commissionByPeriod.get(row.period) ?? '0',
      ),
    }));
  }

  private async computeSalesByAgent(range: ResolvedDateRange) {
    let query = this.db.selectFrom('sales.sales');

    if (range.start) {
      query = query.where('sales.sales.sale_date', '>=', range.start);
    }

    if (range.end) {
      query = query.where('sales.sales.sale_date', '<=', range.end);
    }

    const salesRows = await query
      .select(() => [
        sql<string>`coalesce(nullif(trim(sales.sales.agent_name), ''), 'Unassigned')`.as(
          'agentName',
        ),
        sql<string>`count(*)`.as('salesCount'),
        sql<string>`coalesce(sum(sales.sales.final_sale_amount::numeric), 0)::text`.as(
          'revenue',
        ),
        sql<string>`coalesce(sum(sales.sales.gross_profit_amount::numeric), 0)::text`.as(
          'grossProfit',
        ),
      ])
      .groupBy(
        sql`coalesce(nullif(trim(sales.sales.agent_name), ''), 'Unassigned')`,
      )
      .orderBy(sql`sum(sales.sales.final_sale_amount::numeric)`, 'desc')
      .execute();

    const commissionRows = await this.db
      .selectFrom('sales.commissions')
      .innerJoin('sales.sales', 'sales.sales.id', 'sales.commissions.sale_id')
      .$if(Boolean(range.start), (qb) =>
        qb.where('sales.sales.sale_date', '>=', range.start as Date),
      )
      .$if(Boolean(range.end), (qb) =>
        qb.where('sales.sales.sale_date', '<=', range.end as Date),
      )
      .select(() => [
        sql<string>`coalesce(nullif(trim(sales.sales.agent_name), ''), 'Unassigned')`.as(
          'agentName',
        ),
        sql<string>`coalesce(sum(sales.commissions.final_amount::numeric), 0)::text`.as(
          'commissionPayouts',
        ),
      ])
      .groupBy(
        sql`coalesce(nullif(trim(sales.sales.agent_name), ''), 'Unassigned')`,
      )
      .execute();

    const commissionByAgent = new Map(
      commissionRows.map((row) => [row.agentName, row.commissionPayouts]),
    );

    return salesRows.map((row) => {
      const revenue = normalizeMoney(row.revenue);
      const grossProfit = normalizeMoney(row.grossProfit);
      const salesCount = Number(row.salesCount);

      return {
        agentName: row.agentName,
        salesCount,
        revenue,
        grossProfit,
        commissionPayouts: normalizeMoney(
          commissionByAgent.get(row.agentName) ?? '0',
        ),
        averageSaleValue: averageMoney(revenue, salesCount),
        grossMarginPercent: toPercentage(Number(grossProfit), Number(revenue)),
      };
    });
  }

  private async computeProfitabilityTrend(
    range: ResolvedDateRange,
    groupBy: GroupByUnit,
    agentName?: string,
  ) {
    // Inline the validated unit as a literal (see computeSalesTrend) so the
    // SELECT and GROUP BY expressions render identically.
    const period = sql<string>`to_char(date_trunc(${sql.lit(groupBy)}, sales.sales.sale_date), 'YYYY-MM-DD')`;

    let query = this.db.selectFrom('sales.sales');

    if (range.start) {
      query = query.where('sales.sales.sale_date', '>=', range.start);
    }

    if (range.end) {
      query = query.where('sales.sales.sale_date', '<=', range.end);
    }

    if (agentName) {
      query = query.where(
        sql<boolean>`lower(coalesce(sales.sales.agent_name, '')) = lower(${agentName})`,
      );
    }

    const rows = await query
      .select(() => [
        period.as('period'),
        sql<string>`coalesce(sum(sales.sales.final_sale_amount::numeric), 0)::text`.as(
          'revenue',
        ),
        sql<string>`coalesce(sum(sales.sales.gross_profit_amount::numeric), 0)::text`.as(
          'grossProfit',
        ),
      ])
      .groupBy(period)
      .orderBy(period)
      .execute();

    return rows.map((row) => {
      const revenue = normalizeMoney(row.revenue);
      const grossProfit = normalizeMoney(row.grossProfit);

      return {
        period: row.period,
        periodLabel: formatPeriodLabel(row.period, groupBy),
        revenue,
        grossProfit,
        grossMarginPercent: toPercentage(Number(grossProfit), Number(revenue)),
      };
    });
  }

  private async computeInventorySnapshot() {
    const statusRows = await this.db
      .selectFrom('inventory.vehicles')
      .select(({ fn }) => ['status', fn.count<string>('id').as('count')])
      .groupBy('status')
      .execute();

    const valueRow = await this.db
      .selectFrom('inventory.vehicles')
      .select(
        sql<string>`coalesce(sum(inventory.vehicles.purchase_price::numeric) filter (where inventory.vehicles.status <> 'Sold'), 0)::text`.as(
          'totalInventoryValue',
        ),
      )
      .executeTakeFirstOrThrow();

    const byStatus = statusRows.map((row) => ({
      status: row.status,
      count: Number(row.count),
    }));

    const byStatusMap = byStatus.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});

    const totalUnits = byStatus.reduce((sum, row) => sum + row.count, 0);
    const activeUnits = totalUnits - (byStatusMap.Sold ?? 0);

    return {
      byStatus,
      byStatusMap,
      totalUnits,
      activeUnits,
      totalInventoryValue: normalizeMoney(valueRow.totalInventoryValue),
    };
  }

  private async computeInventoryAging() {
    // Aged inventory only considers active (unsold) units, bucketed by how long
    // they have been in the system (created_at → now).
    const bucket = sql<string>`
      case
        when now() - inventory.vehicles.created_at < interval '31 days' then '0-30 days'
        when now() - inventory.vehicles.created_at < interval '61 days' then '31-60 days'
        when now() - inventory.vehicles.created_at < interval '91 days' then '61-90 days'
        else '90+ days'
      end
    `;
    const sortKey = sql<string>`
      case
        when now() - inventory.vehicles.created_at < interval '31 days' then 1
        when now() - inventory.vehicles.created_at < interval '61 days' then 2
        when now() - inventory.vehicles.created_at < interval '91 days' then 3
        else 4
      end
    `;

    const rows = await this.db
      .selectFrom('inventory.vehicles')
      .where('inventory.vehicles.status', '<>', 'Sold')
      .select(() => [
        bucket.as('bucket'),
        sql<string>`count(*)`.as('count'),
        sortKey.as('sortKey'),
      ])
      .groupBy([bucket, sortKey])
      .orderBy(sortKey)
      .execute();

    return rows.map((row) => ({
      bucket: row.bucket,
      count: Number(row.count),
    }));
  }

  private async computeInventoryByBrand(status?: string) {
    let query = this.db.selectFrom('inventory.vehicles');

    if (status) {
      query = query.where('inventory.vehicles.status', '=', status);
    }

    const rows = await query
      .select('inventory.vehicles.brand as brand')
      .select(() => [
        sql<string>`count(*)`.as('total'),
        sql<string>`count(*) filter (where inventory.vehicles.status = 'Available')`.as(
          'available',
        ),
        sql<string>`count(*) filter (where inventory.vehicles.status = 'Reserved')`.as(
          'reserved',
        ),
        sql<string>`count(*) filter (where inventory.vehicles.status = 'Sold')`.as(
          'sold',
        ),
      ])
      .groupBy('inventory.vehicles.brand')
      .orderBy(sql`count(*)`, 'desc')
      .orderBy('brand')
      .execute();

    return rows.map((row) => ({
      brand: row.brand,
      total: Number(row.total),
      available: Number(row.available),
      reserved: Number(row.reserved),
      sold: Number(row.sold),
    }));
  }

  private async computeBuyerLeadsByStatus(range: ResolvedDateRange) {
    let query = this.db.selectFrom('crm.buyer_leads');

    if (range.start) {
      query = query.where('crm.buyer_leads.created_at', '>=', range.start);
    }

    if (range.end) {
      query = query.where('crm.buyer_leads.created_at', '<=', range.end);
    }

    const rows = await query
      .select(({ fn }) => ['status', fn.count<string>('id').as('count')])
      .groupBy('status')
      .orderBy('status')
      .execute();

    return rows.map((row) => ({
      status: row.status,
      count: Number(row.count),
    }));
  }

  private async computeSellerLeadsByStatus(range: ResolvedDateRange) {
    let query = this.db.selectFrom('crm.seller_leads');

    if (range.start) {
      query = query.where('crm.seller_leads.created_at', '>=', range.start);
    }

    if (range.end) {
      query = query.where('crm.seller_leads.created_at', '<=', range.end);
    }

    const rows = await query
      .select(({ fn }) => ['status', fn.count<string>('id').as('count')])
      .groupBy('status')
      .orderBy('status')
      .execute();

    return rows.map((row) => ({
      status: row.status,
      count: Number(row.count),
    }));
  }

  private async computeLeadsConversion(range: ResolvedDateRange) {
    const buyerRow = await this.db
      .selectFrom('crm.buyer_leads')
      .$if(Boolean(range.start), (qb) =>
        qb.where('crm.buyer_leads.created_at', '>=', range.start as Date),
      )
      .$if(Boolean(range.end), (qb) =>
        qb.where('crm.buyer_leads.created_at', '<=', range.end as Date),
      )
      .select(() => [
        sql<string>`count(*)`.as('total'),
        sql<string>`count(*) filter (where status = 'Won')`.as('won'),
        sql<string>`count(*) filter (where status = 'Lost')`.as('lost'),
      ])
      .executeTakeFirstOrThrow();

    const sellerRow = await this.db
      .selectFrom('crm.seller_leads')
      .$if(Boolean(range.start), (qb) =>
        qb.where('crm.seller_leads.created_at', '>=', range.start as Date),
      )
      .$if(Boolean(range.end), (qb) =>
        qb.where('crm.seller_leads.created_at', '<=', range.end as Date),
      )
      .select(() => [
        sql<string>`count(*)`.as('total'),
        sql<string>`count(*) filter (where status = 'Purchased')`.as(
          'purchased',
        ),
        sql<string>`count(*) filter (where status = 'Rejected')`.as('rejected'),
      ])
      .executeTakeFirstOrThrow();

    const buyerTotal = Number(buyerRow.total);
    const buyerWon = Number(buyerRow.won);
    const buyerLost = Number(buyerRow.lost);
    const sellerTotal = Number(sellerRow.total);
    const sellerPurchased = Number(sellerRow.purchased);
    const sellerRejected = Number(sellerRow.rejected);

    return {
      totalBuyerLeads: buyerTotal,
      totalSellerLeads: sellerTotal,
      buyerWon,
      buyerLost,
      buyerActive: buyerTotal - buyerWon - buyerLost,
      // Conversion = won buyer leads / all buyer leads created in range.
      buyerConversionRate: toPercentage(buyerWon, buyerTotal),
      sellerPurchased,
      sellerRejected,
      sellerActive: sellerTotal - sellerPurchased - sellerRejected,
      // Conversion = purchased seller leads / all seller leads created in range.
      sellerConversionRate: toPercentage(sellerPurchased, sellerTotal),
    };
  }

  private describeRange(range: ResolvedDateRange) {
    return {
      startDate: range.start ? range.start.toISOString() : null,
      endDate: range.end ? range.end.toISOString() : null,
    };
  }
}
