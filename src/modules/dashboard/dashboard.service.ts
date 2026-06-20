import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';

import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { centsToMoney } from '../sales/sales.helpers';

@Injectable()
export class DashboardService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async getDashboard() {
    const [availableVehicles, reservedVehicles, soldVehicles] = await Promise.all([
      this.countVehiclesByStatus('Available'),
      this.countVehiclesByStatus('Reserved'),
      this.countVehiclesByStatus('Sold'),
    ]);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

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

    const [newSellerLeads, newBuyerLeads] = await Promise.all([
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
    ]);

    const monthlyRevenueCents = monthlySales.reduce(
      (sum, sale) => sum + this.moneyToCents(sale.final_sale_amount),
      0,
    );
    const monthlyProfitCents = monthlySales.reduce(
      (sum, sale) => sum + this.moneyToCents(sale.gross_profit_amount),
      0,
    );

    return {
      metrics: {
        availableVehicles,
        reservedVehicles,
        soldVehicles,
        monthlySales: monthlySales.length,
        monthlyRevenue: centsToMoney(monthlyRevenueCents),
        monthlyProfit: centsToMoney(monthlyProfitCents),
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

  private async countVehiclesByStatus(status: 'Available' | 'Reserved' | 'Sold') {
    const result = await this.db
      .selectFrom('inventory.vehicles')
      .select(({ fn }) => fn.count<string>('id').as('count'))
      .where('status', '=', status)
      .executeTakeFirstOrThrow();

    return Number(result.count);
  }

  private moneyToCents(value: string | null) {
    if (!value) {
      return 0;
    }

    const [wholePart, decimalPart = ''] = value.split('.');
    return Number(wholePart) * 100 + Number(decimalPart.padEnd(2, '0'));
  }
}
