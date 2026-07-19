import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';

import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { ExpenseReportsService } from '../expenses/expense-reports.service';
import type { SellerLeadStatus } from '../../database/schema';
import { centsToMoney } from '../sales/sales.helpers';
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

const DASHBOARD_ISSUE_LABEL_OVERRIDES: Record<string, string> = {
  'freshness.stale_warning': 'Stale inventory (60+ days)',
  'freshness.stale_critical': 'Stale inventory (90+ days)',
};

const SEVERITY_RANK: Record<VehicleQualityIssueSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const ACTIVE_SELLER_LEAD_STATUSES: SellerLeadStatus[] = [
  'New Inquiry',
  'Contacted',
  'Inspection Scheduled',
  'Evaluated',
  'Negotiating',
  'Approved to Buy',
];

type DashboardTrendPoint = {
  label: string;
  periodStart: string;
  vehiclesAcquired: number;
  vehiclesSold: number;
};

@Injectable()
export class DashboardService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly expenseReportsService: ExpenseReportsService,
  ) {}

  async getDashboard() {
    const [
      availableVehicles,
      reservedVehicles,
      soldVehicles,
      inventoryQuality,
      expenseSummary,
    ] = await Promise.all([
      this.countVehiclesByStatus('Available'),
      this.countVehiclesByStatus('Reserved'),
      this.countVehiclesByStatus('Sold'),
      this.getInventoryQualitySummary(),
      this.expenseReportsService.getDashboardSummary(),
    ]);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const tomorrowStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );

    const monthlySales = await this.db
      .selectFrom('sales.sales')
      .select(['id', 'final_sale_amount', 'gross_profit_amount'])
      .where('sale_date', '>=', monthStart)
      .where('sale_date', '<', nextMonthStart)
      .execute();

    const overdueFollowUps = await this.db
      .selectFrom('crm.follow_ups')
      .selectAll()
      .where('completed_at', 'is', null)
      .where('due_at', '<', now)
      .orderBy('due_at', 'asc')
      .execute();

    const dueTodayFollowUps = await this.db
      .selectFrom('crm.follow_ups')
      .selectAll()
      .where('completed_at', 'is', null)
      .where('due_at', '>=', todayStart)
      .where('due_at', '<', tomorrowStart)
      .orderBy('due_at', 'asc')
      .execute();

    const [
      newSellerLeads,
      newBuyerLeads,
      sellerLeadStatuses,
      acquiredVehicleDates,
      soldVehicleDates,
    ] = await Promise.all([
      this.db
        .selectFrom('crm.seller_leads')
        .selectAll()
        .where('status', '=', 'New Inquiry')
        .orderBy('created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('crm.buyer_leads')
        .selectAll()
        .where('status', '=', 'New Inquiry')
        .orderBy('created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('crm.seller_leads')
        .select(['status', 'inspection_completed_at'])
        .where('status', 'in', ACTIVE_SELLER_LEAD_STATUSES)
        .execute(),
      this.db
        .selectFrom('inventory.vehicles')
        .select(['created_at'])
        .where('created_at', '>=', this.getMonthStart(now, -11))
        .execute(),
      this.db
        .selectFrom('sales.sales')
        .select(['sale_date'])
        .where('sale_date', '>=', this.getMonthStart(now, -11))
        .execute(),
    ]);

    const monthlyRevenueCents = monthlySales.reduce(
      (sum, sale) => sum + this.moneyToCents(sale.final_sale_amount),
      0,
    );
    const monthlyProfitCents = monthlySales.reduce(
      (sum, sale) => sum + this.moneyToCents(sale.gross_profit_amount),
      0,
    );

    const sellerLeadPipeline = ACTIVE_SELLER_LEAD_STATUSES.map((status) => ({
      status,
      count: sellerLeadStatuses.filter((lead) => lead.status === status).length,
    }));
    const activeSellerLeads = sellerLeadPipeline.reduce(
      (sum, item) => sum + item.count,
      0,
    );
    const inspectionsPending = sellerLeadStatuses.filter(
      (lead) =>
        lead.status === 'Inspection Scheduled' &&
        lead.inspection_completed_at === null,
    ).length;
    const approvedLeadsAwaitingConversion = sellerLeadStatuses.filter(
      (lead) => lead.status === 'Approved to Buy',
    ).length;
    const acquiredDates = acquiredVehicleDates.map(
      (vehicle) => vehicle.created_at,
    );
    const soldDates = soldVehicleDates.map((sale) => sale.sale_date);

    return {
      metrics: {
        activeInventory: inventoryQuality.totalActiveVehicles,
        activeSellerLeads,
        sellerLeadsRequiringAction: activeSellerLeads,
        inspectionsPending,
        approvedLeadsAwaitingConversion,
        availableVehicles,
        reservedVehicles,
        soldVehicles,
        monthlySales: monthlySales.length,
        monthlyRevenue: centsToMoney(monthlyRevenueCents),
        monthlyProfit: centsToMoney(monthlyProfitCents),
        inventoryQuality,
        expenses: expenseSummary,
      },
      analytics: {
        acquisitionSalesTrend: {
          twelveWeeks: this.buildWeeklyTrend(acquiredDates, soldDates, now, 12),
          sixMonths: this.buildMonthlyTrend(acquiredDates, soldDates, now, 6),
          oneYear: this.buildMonthlyTrend(acquiredDates, soldDates, now, 12),
        },
        sellerLeadPipeline,
      },
      queues: {
        overdueFollowUps: overdueFollowUps.map((followUp) => ({
          id: followUp.id,
          leadType: followUp.lead_type,
          sellerLeadId: followUp.seller_lead_id,
          buyerLeadId: followUp.buyer_lead_id,
          assigneeUserId: followUp.assignee_user_id,
          dueAt: followUp.due_at,
          status: 'Overdue',
          note: followUp.note,
        })),
        dueTodayFollowUps: dueTodayFollowUps.map((followUp) => ({
          id: followUp.id,
          leadType: followUp.lead_type,
          sellerLeadId: followUp.seller_lead_id,
          buyerLeadId: followUp.buyer_lead_id,
          assigneeUserId: followUp.assignee_user_id,
          dueAt: followUp.due_at,
          status: 'Due',
          note: followUp.note,
        })),
        newSellerLeads: newSellerLeads.map((lead) => ({
          id: lead.id,
          sellerName: lead.seller_name,
          vehicleBrand: lead.vehicle_brand,
          vehicleModel: lead.vehicle_model,
          status: lead.status,
          createdAt: lead.created_at,
        })),
        newBuyerLeads: newBuyerLeads.map((lead) => ({
          id: lead.id,
          buyerName: lead.buyer_name,
          contactNumber: lead.contact_number,
          status: lead.status,
          createdAt: lead.created_at,
        })),
      },
    };
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

  private async countVehiclesByStatus(
    status: 'Available' | 'Reserved' | 'Sold',
  ) {
    const result = await this.db
      .selectFrom('inventory.vehicles')
      .select(({ fn }) => fn.count<string>('id').as('count'))
      .where('status', '=', status)
      .executeTakeFirstOrThrow();

    return Number(result.count);
  }

  private buildWeeklyTrend(
    acquiredDates: Date[],
    soldDates: Date[],
    now: Date,
    weeks: number,
  ): DashboardTrendPoint[] {
    const currentWeekStart = this.getWeekStart(now);

    return Array.from({ length: weeks }, (_, index) => {
      const offset = index - (weeks - 1);
      const periodStart = new Date(currentWeekStart);
      periodStart.setDate(periodStart.getDate() + offset * 7);
      const periodEnd = new Date(periodStart);
      periodEnd.setDate(periodEnd.getDate() + 7);

      return this.createTrendPoint(
        periodStart,
        periodEnd,
        acquiredDates,
        soldDates,
        new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
        }).format(periodStart),
      );
    });
  }

  private buildMonthlyTrend(
    acquiredDates: Date[],
    soldDates: Date[],
    now: Date,
    months: number,
  ): DashboardTrendPoint[] {
    return Array.from({ length: months }, (_, index) => {
      const offset = index - (months - 1);
      const periodStart = this.getMonthStart(now, offset);
      const periodEnd = this.getMonthStart(now, offset + 1);

      return this.createTrendPoint(
        periodStart,
        periodEnd,
        acquiredDates,
        soldDates,
        new Intl.DateTimeFormat('en-US', { month: 'short' }).format(
          periodStart,
        ),
      );
    });
  }

  private createTrendPoint(
    periodStart: Date,
    periodEnd: Date,
    acquiredDates: Date[],
    soldDates: Date[],
    label: string,
  ): DashboardTrendPoint {
    return {
      label,
      periodStart: periodStart.toISOString(),
      vehiclesAcquired: this.countDatesInPeriod(
        acquiredDates,
        periodStart,
        periodEnd,
      ),
      vehiclesSold: this.countDatesInPeriod(soldDates, periodStart, periodEnd),
    };
  }

  private countDatesInPeriod(dates: Date[], start: Date, end: Date) {
    return dates.filter((date) => date >= start && date < end).length;
  }

  private getWeekStart(value: Date) {
    const start = new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
    );
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    return start;
  }

  private getMonthStart(value: Date, monthOffset: number) {
    return new Date(value.getFullYear(), value.getMonth() + monthOffset, 1);
  }

  private moneyToCents(value: string | null) {
    if (!value) {
      return 0;
    }

    const [wholePart, decimalPart = ''] = value.split('.');
    return Number(wholePart) * 100 + Number(decimalPart.padEnd(2, '0'));
  }
}
