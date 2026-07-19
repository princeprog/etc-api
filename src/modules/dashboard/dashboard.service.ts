import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';

import type { CurrentUser } from '../../common/types/auth.types';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import type {
  BuyerLeadStatus,
  SellerLeadStatus,
  VehicleStatus,
} from '../../database/schema';
import { ExpenseReportsService } from '../expenses/expense-reports.service';
import {
  formatPeriodLabel,
  normalizeMoney,
  toPercentage,
} from '../reports/reports.helpers';
import { ReportsService } from '../reports/reports.service';
import { evaluateVehicleQuality } from '../vehicles/vehicle-quality.helpers';
import type {
  VehicleQualityGrade,
  VehicleQualityIssue,
  VehicleQualityIssueSeverity,
} from '../vehicles/vehicle-quality.types';
import {
  parseVehicleStatus,
  parseVehicleTrackedCostCategory,
} from '../vehicles/vehicles.helpers';
import type {
  VehiclePhotoInput,
  VehicleTrackedCostResponse,
} from '../vehicles/vehicles.types';
import type { DashboardQueryDto } from './dto/dashboard-query.dto';
import {
  resolveDashboardPeriod,
  type DashboardPeriod,
} from './dashboard-period';

type InventoryQualitySummary = {
  averageScore: number;
  totalActiveVehicles: number;
  gradeCounts: Record<VehicleQualityGrade, number>;
  topIssues: Array<{
    code: string;
    label: string;
    severity: VehicleQualityIssueSeverity;
    count: number;
  }>;
  lastEvaluatedAt: string;
};

type SharedInventory = {
  active: number;
  statuses: Record<Exclude<VehicleStatus, 'Sold'>, number>;
  quality: InventoryQualitySummary;
};

const ACTIVE_SELLER_LEAD_STATUSES: SellerLeadStatus[] = [
  'New Inquiry',
  'Contacted',
  'Inspection Scheduled',
  'Evaluated',
  'Negotiating',
  'Approved to Buy',
];

const ACTIVE_BUYER_LEAD_STATUSES: BuyerLeadStatus[] = [
  'New Inquiry',
  'Contacted',
  'Interested',
  'Negotiating',
  'Reserved',
];

const ACTIVE_INVENTORY_STATUSES: Exclude<VehicleStatus, 'Sold'>[] = [
  'Incoming',
  'Reconditioning',
  'Available',
  'Reserved',
];

const DASHBOARD_ISSUE_LABEL_OVERRIDES: Record<string, string> = {
  'freshness.stale_warning': 'Stale inventory (60+ days)',
  'freshness.stale_critical': 'Stale inventory (90+ days)',
};

const SEVERITY_RANK: Record<VehicleQualityIssueSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

@Injectable()
export class DashboardService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly expenseReportsService: ExpenseReportsService,
    private readonly reportsService: ReportsService,
  ) {}

  async getDashboard(user: CurrentUser, query: DashboardQueryDto = {}) {
    const period = resolveDashboardPeriod(query.range);
    const assigneeUserId = user.role === 'staff' ? user.id : undefined;

    const [inventoryQuality, inventoryStatuses, leadContext, followUpCounts] =
      await Promise.all([
        this.getInventoryQualitySummary(),
        this.getInventoryStatusCounts(),
        this.getLeadContext(assigneeUserId),
        this.getFollowUpCounts(assigneeUserId),
      ]);

    const inventory = {
      active: ACTIVE_INVENTORY_STATUSES.reduce(
        (total, status) => total + inventoryStatuses[status],
        0,
      ),
      statuses: inventoryStatuses,
      quality: inventoryQuality,
    };

    if (user.role === 'admin') {
      return this.buildAdminDashboard(
        period,
        inventory,
        leadContext,
        followUpCounts,
      );
    }

    return this.buildStaffDashboard(
      user,
      period,
      inventory,
      leadContext,
      followUpCounts,
    );
  }

  private async buildAdminDashboard(
    period: DashboardPeriod,
    inventory: SharedInventory,
    leadContext: Awaited<ReturnType<DashboardService['getLeadContext']>>,
    followUpCounts: Awaited<ReturnType<DashboardService['getFollowUpCounts']>>,
  ) {
    const reportQuery = this.toReportQuery(period.start, period.end, period);
    const previousReportQuery = this.toReportQuery(
      period.previousStart,
      period.previousEnd,
      period,
    );

    const [overview, salesReport, previousOverview, expenseReport] =
      await Promise.all([
        this.reportsService.getOverview(reportQuery),
        this.reportsService.getSalesReport(reportQuery),
        this.reportsService.getOverview(previousReportQuery),
        this.expenseReportsService.getMonthlyReport({
          startDate: reportQuery.startDate,
          endDate: reportQuery.endDate,
        }),
      ]);

    return {
      view: 'admin' as const,
      period: this.describePeriod(period),
      performance: {
        totalSales: overview.sales.totalSales,
        revenue: overview.sales.totalRevenue,
        grossProfit: overview.sales.totalGrossProfit,
        grossMarginPercent: overview.sales.grossMarginPercent,
        averageSaleValue: overview.sales.averageSaleValue,
        expenses: expenseReport.summary,
        comparison: {
          salesPercent: this.percentageChange(
            overview.sales.totalSales,
            previousOverview.sales.totalSales,
          ),
          revenuePercent: this.percentageChange(
            Number(overview.sales.totalRevenue),
            Number(previousOverview.sales.totalRevenue),
          ),
          grossProfitPercent: this.percentageChange(
            Number(overview.sales.totalGrossProfit),
            Number(previousOverview.sales.totalGrossProfit),
          ),
        },
      },
      inventory: {
        ...inventory,
        totalInventoryValue: overview.inventory.totalInventoryValue,
      },
      leads: {
        health: overview.leads,
        sellerPipeline: leadContext.sellerPipeline,
        buyerPipeline: leadContext.buyerPipeline,
      },
      attention: {
        overdueFollowUps: followUpCounts.overdue,
        dueTodayFollowUps: followUpCounts.dueToday,
        pendingInspections: leadContext.pendingInspections,
        approvedSellerLeads: leadContext.approvedSellerLeads,
        incompleteListings: inventory.quality.gradeCounts.incomplete,
        overdueExpenses: expenseReport.summary.overdueCount,
      },
      trend: salesReport.trend,
    };
  }

  private async buildStaffDashboard(
    user: CurrentUser,
    period: DashboardPeriod,
    inventory: SharedInventory,
    leadContext: Awaited<ReturnType<DashboardService['getLeadContext']>>,
    followUpCounts: Awaited<ReturnType<DashboardService['getFollowUpCounts']>>,
  ) {
    const [sales, priorityQueue] = await Promise.all([
      this.getPersonalSales(user.id, period),
      this.getPriorityQueue(user.id),
    ]);

    const activeSellerLeads = leadContext.sellerPipeline.reduce(
      (total, item) => total + item.count,
      0,
    );
    const activeBuyerLeads = leadContext.buyerPipeline.reduce(
      (total, item) => total + item.count,
      0,
    );

    return {
      view: 'staff' as const,
      period: this.describePeriod(period),
      assignments: {
        openLeads: activeSellerLeads + activeBuyerLeads,
        activeSellerLeads,
        activeBuyerLeads,
        dueTodayFollowUps: followUpCounts.dueToday,
        overdueFollowUps: followUpCounts.overdue,
        pendingInspections: leadContext.pendingInspections,
      },
      personalPerformance: sales,
      inventory,
      pipelines: {
        seller: leadContext.sellerPipeline,
        buyer: leadContext.buyerPipeline,
      },
      priorityQueue,
    };
  }

  private describePeriod(period: DashboardPeriod) {
    return {
      key: period.key,
      label: period.label,
      startDate: period.start.toISOString(),
      endDate: period.end.toISOString(),
      groupBy: period.groupBy,
    };
  }

  private toReportQuery(start: Date, end: Date, period: DashboardPeriod) {
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      groupBy: period.groupBy,
    };
  }

  private async getInventoryStatusCounts() {
    const rows = await this.db
      .selectFrom('inventory.vehicles')
      .select(['status'])
      .select(({ fn }) => fn.count<string>('id').as('count'))
      .where('status', 'in', ACTIVE_INVENTORY_STATUSES)
      .groupBy('status')
      .execute();

    const counts: Record<Exclude<VehicleStatus, 'Sold'>, number> = {
      Incoming: 0,
      Reconditioning: 0,
      Available: 0,
      Reserved: 0,
    };

    for (const row of rows) {
      const status = parseVehicleStatus(row.status, 'Incoming');
      if (status !== 'Sold') {
        counts[status] = Number(row.count);
      }
    }

    return counts;
  }

  private async getLeadContext(assigneeUserId?: string) {
    const [sellerRows, buyerRows] = await Promise.all([
      this.db
        .selectFrom('crm.seller_leads')
        .select(['status', 'inspection_completed_at'])
        .where('status', 'in', ACTIVE_SELLER_LEAD_STATUSES)
        .$if(Boolean(assigneeUserId), (builder) =>
          builder.where('assignee_user_id', '=', assigneeUserId!),
        )
        .execute(),
      this.db
        .selectFrom('crm.buyer_leads')
        .select(['status'])
        .where('status', 'in', ACTIVE_BUYER_LEAD_STATUSES)
        .$if(Boolean(assigneeUserId), (builder) =>
          builder.where('assignee_user_id', '=', assigneeUserId!),
        )
        .execute(),
    ]);

    return {
      sellerPipeline: ACTIVE_SELLER_LEAD_STATUSES.map((status) => ({
        status,
        count: sellerRows.filter((lead) => lead.status === status).length,
      })),
      buyerPipeline: ACTIVE_BUYER_LEAD_STATUSES.map((status) => ({
        status,
        count: buyerRows.filter((lead) => lead.status === status).length,
      })),
      pendingInspections: sellerRows.filter(
        (lead) =>
          lead.status === 'Inspection Scheduled' &&
          lead.inspection_completed_at === null,
      ).length,
      approvedSellerLeads: sellerRows.filter(
        (lead) => lead.status === 'Approved to Buy',
      ).length,
    };
  }

  private async getFollowUpCounts(assigneeUserId?: string) {
    const now = new Date();
    const todayStart = this.startOfDay(now);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const scoped = () =>
      this.db
        .selectFrom('crm.follow_ups')
        .where('completed_at', 'is', null)
        .$if(Boolean(assigneeUserId), (builder) =>
          builder.where('assignee_user_id', '=', assigneeUserId!),
        );

    const [overdue, dueToday] = await Promise.all([
      scoped()
        .where('due_at', '<', now)
        .select(({ fn }) => fn.count<string>('id').as('count'))
        .executeTakeFirstOrThrow(),
      scoped()
        .where('due_at', '>=', todayStart)
        .where('due_at', '<', tomorrowStart)
        .select(({ fn }) => fn.count<string>('id').as('count'))
        .executeTakeFirstOrThrow(),
    ]);

    return {
      overdue: Number(overdue.count),
      dueToday: Number(dueToday.count),
    };
  }

  private async getPersonalSales(userId: string, period: DashboardPeriod) {
    const [current, previous, trend] = await Promise.all([
      this.getPersonalSalesSummary(userId, period.start, period.end),
      this.getPersonalSalesSummary(
        userId,
        period.previousStart,
        period.previousEnd,
      ),
      this.getPersonalSalesTrend(userId, period),
    ]);

    return {
      ...current,
      comparisonPercent: this.percentageChange(
        current.totalSales,
        previous.totalSales,
      ),
      trend,
    };
  }

  private async getPersonalSalesSummary(
    userId: string,
    start: Date,
    end: Date,
  ) {
    const row = await this.db
      .selectFrom('sales.sales')
      .where('created_by_user_id', '=', userId)
      .where('sale_date', '>=', start)
      .where('sale_date', '<=', end)
      .select(({ fn }) => [
        fn.count<string>('id').as('totalSales'),
        sql<string>`coalesce(sum(final_sale_amount::numeric), 0)::text`.as(
          'revenue',
        ),
        sql<string>`coalesce(sum(gross_profit_amount::numeric), 0)::text`.as(
          'grossProfit',
        ),
      ])
      .executeTakeFirstOrThrow();

    const totalSales = Number(row.totalSales);
    const revenue = normalizeMoney(row.revenue);

    return {
      totalSales,
      revenue,
      grossProfit: normalizeMoney(row.grossProfit),
      averageSaleValue: normalizeMoney(
        totalSales === 0 ? 0 : Number(revenue) / totalSales,
      ),
    };
  }

  private async getPersonalSalesTrend(userId: string, period: DashboardPeriod) {
    const periodExpression = sql<string>`to_char(date_trunc(${sql.lit(period.groupBy)}, sale_date), 'YYYY-MM-DD')`;
    const rows = await this.db
      .selectFrom('sales.sales')
      .where('created_by_user_id', '=', userId)
      .where('sale_date', '>=', period.start)
      .where('sale_date', '<=', period.end)
      .select(() => [
        periodExpression.as('period'),
        sql<string>`count(*)`.as('salesCount'),
        sql<string>`coalesce(sum(final_sale_amount::numeric), 0)::text`.as(
          'revenue',
        ),
        sql<string>`coalesce(sum(gross_profit_amount::numeric), 0)::text`.as(
          'grossProfit',
        ),
      ])
      .groupBy(periodExpression)
      .orderBy(periodExpression)
      .execute();

    return rows.map((row) => ({
      period: row.period,
      periodLabel: formatPeriodLabel(row.period, period.groupBy),
      salesCount: Number(row.salesCount),
      revenue: normalizeMoney(row.revenue),
      grossProfit: normalizeMoney(row.grossProfit),
    }));
  }

  private async getPriorityQueue(userId: string) {
    const now = new Date();
    const todayStart = this.startOfDay(now);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 7);

    const rows = await this.db
      .selectFrom('crm.follow_ups as follow_up')
      .leftJoin(
        'crm.seller_leads as seller_lead',
        'seller_lead.id',
        'follow_up.seller_lead_id',
      )
      .leftJoin(
        'crm.buyer_leads as buyer_lead',
        'buyer_lead.id',
        'follow_up.buyer_lead_id',
      )
      .where('follow_up.assignee_user_id', '=', userId)
      .where('follow_up.completed_at', 'is', null)
      .where('follow_up.due_at', '<=', horizon)
      .select([
        'follow_up.id',
        'follow_up.lead_type',
        'follow_up.seller_lead_id',
        'follow_up.buyer_lead_id',
        'follow_up.due_at',
        'follow_up.note',
        'seller_lead.seller_name',
        'seller_lead.vehicle_brand',
        'seller_lead.vehicle_model',
        'buyer_lead.buyer_name',
        'buyer_lead.contact_number',
      ])
      .orderBy('follow_up.due_at', 'asc')
      .limit(6)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      leadType: row.lead_type,
      leadId:
        row.lead_type === 'seller' ? row.seller_lead_id : row.buyer_lead_id,
      leadName:
        row.lead_type === 'seller'
          ? (row.seller_name ?? 'Seller lead')
          : (row.buyer_name ?? 'Buyer lead'),
      leadSecondary:
        row.lead_type === 'seller'
          ? [row.vehicle_brand, row.vehicle_model].filter(Boolean).join(' ') ||
            null
          : row.contact_number,
      dueAt: row.due_at,
      note: row.note,
      urgency:
        row.due_at < now
          ? ('overdue' as const)
          : row.due_at >= todayStart && row.due_at < tomorrowStart
            ? ('today' as const)
            : ('upcoming' as const),
    }));
  }

  private async getInventoryQualitySummary() {
    const [vehicles, photos, costs] = await Promise.all([
      this.db
        .selectFrom('inventory.vehicles')
        .selectAll()
        .where('status', '!=', 'Sold')
        .execute(),
      this.db
        .selectFrom('inventory.vehicle_photos')
        .select(['vehicle_id', 'file_url', 'sort_order'])
        .orderBy('sort_order', 'asc')
        .execute(),
      this.db
        .selectFrom('inventory.vehicle_tracked_costs')
        .selectAll()
        .execute(),
    ]);

    const photosByVehicle = new Map<string, VehiclePhotoInput[]>();
    for (const photo of photos) {
      const list = photosByVehicle.get(photo.vehicle_id) ?? [];
      list.push({ fileUrl: photo.file_url, sortOrder: photo.sort_order });
      photosByVehicle.set(photo.vehicle_id, list);
    }

    const costsByVehicle = new Map<string, VehicleTrackedCostResponse[]>();
    for (const cost of costs) {
      const list = costsByVehicle.get(cost.vehicle_id) ?? [];
      list.push({
        id: cost.id,
        category: parseVehicleTrackedCostCategory(cost.category),
        amount: cost.amount,
        note: cost.note,
        createdAt: cost.created_at,
        updatedAt: cost.updated_at,
      });
      costsByVehicle.set(cost.vehicle_id, list);
    }

    const evaluatedAt = new Date();
    const results = vehicles.map((vehicle) =>
      evaluateVehicleQuality(
        {
          id: vehicle.id,
          stockNumber: vehicle.stock_number,
          brand: vehicle.brand,
          model: vehicle.model,
          year: vehicle.year,
          variant: vehicle.variant,
          mileage: vehicle.mileage,
          transmission: vehicle.transmission,
          fuelType: vehicle.fuel_type,
          color: vehicle.color,
          region: vehicle.region,
          features: vehicle.features,
          purchasePrice: vehicle.purchase_price,
          targetSellingPrice: vehicle.target_selling_price,
          minimumAcceptablePrice: vehicle.minimum_acceptable_price,
          acquisitionSource: vehicle.acquisition_source,
          sellerLeadId: vehicle.seller_lead_id,
          status: parseVehicleStatus(vehicle.status, 'Incoming'),
          photos: photosByVehicle.get(vehicle.id) ?? [],
          trackedCosts: costsByVehicle.get(vehicle.id) ?? [],
          createdAt: vehicle.created_at,
        },
        evaluatedAt,
      ),
    );

    const totalActiveVehicles = results.length;
    const averageScore =
      totalActiveVehicles === 0
        ? 0
        : Math.round(
            results.reduce((sum, result) => sum + result.score, 0) /
              totalActiveVehicles,
          );

    const gradeCounts: Record<VehicleQualityGrade, number> = {
      excellent: 0,
      good: 0,
      needs_attention: 0,
      incomplete: 0,
    };
    for (const result of results) {
      gradeCounts[result.grade] += 1;
    }

    const issueAggregates = new Map<
      string,
      {
        code: string;
        label: string;
        severity: VehicleQualityIssueSeverity;
        count: number;
      }
    >();
    for (const result of results) {
      const allIssues: VehicleQualityIssue[] = [
        ...result.blockingIssues,
        ...result.warnings,
        ...result.suggestions,
      ];
      for (const issue of allIssues) {
        const existing = issueAggregates.get(issue.code);
        if (existing) {
          existing.count += 1;
          continue;
        }
        issueAggregates.set(issue.code, {
          code: issue.code,
          label: DASHBOARD_ISSUE_LABEL_OVERRIDES[issue.code] ?? issue.label,
          severity: issue.severity,
          count: 1,
        });
      }
    }

    const topIssues = Array.from(issueAggregates.values())
      .sort(
        (a, b) =>
          b.count - a.count ||
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
      )
      .slice(0, 3);

    return {
      averageScore,
      totalActiveVehicles,
      gradeCounts,
      topIssues,
      lastEvaluatedAt: evaluatedAt.toISOString(),
    };
  }

  private percentageChange(current: number, previous: number) {
    if (previous === 0) {
      return current === 0 ? '0.0' : null;
    }

    return toPercentage(current - previous, previous);
  }

  private startOfDay(value: Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
}
