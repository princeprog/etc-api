import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import type { VehicleStatus } from '../../database/schema';
import { buildBuyerLeadPipeline } from './buyer-lead-pipeline.builder';
import { buildSellerLeadPipeline } from './seller-lead-pipeline.builder';
import type {
  BuyerLeadPipelineContext,
  SellerLeadPipelineContext,
} from './lead-pipeline.contexts';
import {
  BUYER_PIPELINE_TERMINAL_STAGES,
  SELLER_PIPELINE_TERMINAL_STAGES,
} from './lead-pipeline.constants';
import type { LeadPipelineState } from './lead-pipeline.types';

@Injectable()
export class LeadPipelineService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async buildBuyerLeadPipelines(
    leads: BuyerLeadPipelineContext[],
  ): Promise<Map<string, LeadPipelineState>> {
    const byLeadId = new Map<string, LeadPipelineState>();

    for (const lead of leads) {
      byLeadId.set(lead.id, buildBuyerLeadPipeline(lead));
    }

    return byLeadId;
  }

  async buildSellerLeadPipelines(
    leads: SellerLeadPipelineContext[],
  ): Promise<Map<string, LeadPipelineState>> {
    const byLeadId = new Map<string, LeadPipelineState>();

    for (const lead of leads) {
      byLeadId.set(lead.id, buildSellerLeadPipeline(lead));
    }

    return byLeadId;
  }

  async getBuyerLeadPipelineContext(buyerLeadIds: string[]) {
    const byLeadId = new Map<
      string,
      {
        vehicles: BuyerLeadPipelineContext['vehicles'];
        followUps: BuyerLeadPipelineContext['followUps'];
        sales: BuyerLeadPipelineContext['sales'];
      }
    >();

    if (buyerLeadIds.length === 0) {
      return byLeadId;
    }

    const [vehicleRows, followUpRows, saleRows] = await Promise.all([
      this.db
        .selectFrom('crm.lead_vehicle_links')
        .innerJoin(
          'inventory.vehicles',
          'inventory.vehicles.id',
          'crm.lead_vehicle_links.vehicle_id',
        )
        .select([
          'crm.lead_vehicle_links.buyer_lead_id as buyerLeadId',
          'inventory.vehicles.id as vehicleId',
          'inventory.vehicles.status as vehicleStatus',
        ])
        .where('crm.lead_vehicle_links.buyer_lead_id', 'in', buyerLeadIds)
        .execute(),
      this.db
        .selectFrom('crm.follow_ups')
        .select([
          'buyer_lead_id as buyerLeadId',
          'due_at as dueAt',
          'completed_at as completedAt',
        ])
        .where('buyer_lead_id', 'in', buyerLeadIds)
        .orderBy('due_at', 'desc')
        .execute(),
      this.db
        .selectFrom('sales.sales')
        .select(['buyer_lead_id as buyerLeadId', 'id'])
        .where('buyer_lead_id', 'in', buyerLeadIds)
        .execute(),
    ]);

    for (const id of buyerLeadIds) {
      byLeadId.set(id, { vehicles: [], followUps: [], sales: [] });
    }

    for (const row of vehicleRows) {
      byLeadId.get(row.buyerLeadId)?.vehicles.push({
        id: row.vehicleId,
        status: row.vehicleStatus as VehicleStatus,
      });
    }

    for (const row of followUpRows) {
      if (!row.buyerLeadId) {
        continue;
      }
      byLeadId.get(row.buyerLeadId)?.followUps.push({
        dueAt: row.dueAt,
        completedAt: row.completedAt,
      });
    }

    for (const row of saleRows) {
      byLeadId.get(row.buyerLeadId)?.sales.push({ id: row.id });
    }

    return byLeadId;
  }

  async getSellerLeadPipelineContext(sellerLeadIds: string[]) {
    const byLeadId = new Map<
      string,
      {
        followUps: SellerLeadPipelineContext['followUps'];
        vehicleId: string | null;
      }
    >();

    if (sellerLeadIds.length === 0) {
      return byLeadId;
    }

    const [followUpRows, vehicleRows] = await Promise.all([
      this.db
        .selectFrom('crm.follow_ups')
        .select([
          'seller_lead_id as sellerLeadId',
          'due_at as dueAt',
          'completed_at as completedAt',
        ])
        .where('seller_lead_id', 'in', sellerLeadIds)
        .orderBy('due_at', 'desc')
        .execute(),
      this.db
        .selectFrom('inventory.vehicles')
        .select(['seller_lead_id as sellerLeadId', 'id'])
        .where('seller_lead_id', 'in', sellerLeadIds)
        .execute(),
    ]);

    for (const id of sellerLeadIds) {
      byLeadId.set(id, { followUps: [], vehicleId: null });
    }

    for (const row of followUpRows) {
      if (!row.sellerLeadId) {
        continue;
      }
      byLeadId.get(row.sellerLeadId)?.followUps.push({
        dueAt: row.dueAt,
        completedAt: row.completedAt,
      });
    }

    for (const row of vehicleRows) {
      if (!row.sellerLeadId) {
        continue;
      }
      const current = byLeadId.get(row.sellerLeadId);
      if (current && current.vehicleId === null) {
        current.vehicleId = row.id;
      }
    }

    return byLeadId;
  }

  filterByPipelineState<T extends { pipeline?: LeadPipelineState | null }>(
    leadType: 'buyer' | 'seller',
    items: T[],
    pipelineState: string,
  ) {
    switch (pipelineState) {
      case 'blocked':
        return items.filter((item) => (item.pipeline?.blockers.length ?? 0) > 0);
      case 'stale':
        return items.filter((item) => item.pipeline?.isStale);
      case 'ready':
      case 'ready_to_progress':
        return items.filter((item) =>
          this.isReadyToProgress(leadType, item.pipeline),
        );
      default:
        throw new BadRequestException(
          `Unsupported ${leadType} lead pipelineState: ${pipelineState}`,
        );
    }
  }

  isReadyToProgress(
    leadType: 'buyer' | 'seller',
    pipeline?: LeadPipelineState | null,
  ) {
    if (!pipeline || pipeline.isStale || !pipeline.nextAction) {
      return false;
    }

    if (leadType === 'buyer') {
      return !BUYER_PIPELINE_TERMINAL_STAGES.includes(
        pipeline.stage as (typeof BUYER_PIPELINE_TERMINAL_STAGES)[number],
      );
    }

    return !SELLER_PIPELINE_TERMINAL_STAGES.includes(
      pipeline.stage as (typeof SELLER_PIPELINE_TERMINAL_STAGES)[number],
    );
  }
}
