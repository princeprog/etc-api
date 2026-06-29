import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import type {
  BuyerLeadStatus,
  SellerLeadStatus,
  VehicleStatus,
} from '../../database/schema';
import type {
  LeadPipelineBlocker,
  LeadPipelineNextAction,
  LeadPipelineState,
} from './lead-pipeline.types';

type BuyerLeadPipelineContext = {
  id: string;
  status: BuyerLeadStatus;
  contactNumber: string;
  email: string | null;
  facebookName: string | null;
  assigneeUserId: string | null;
  closingNote: string | null;
  latestActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  vehicles: Array<{
    id: string;
    status: VehicleStatus;
  }>;
  followUps: Array<{
    dueAt: Date;
    completedAt: Date | null;
  }>;
  sales: Array<{
    id: string;
  }>;
};

type SellerLeadPipelineContext = {
  id: string;
  status: SellerLeadStatus;
  contactNumber: string;
  email: string | null;
  facebookName: string | null;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYear: number | null;
  askingPrice: string | null;
  targetBuyPrice: string | null;
  expectedResalePrice: string | null;
  assigneeUserId: string | null;
  latestActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  vehicleId: string | null;
  followUps: Array<{
    dueAt: Date;
    completedAt: Date | null;
  }>;
};

@Injectable()
export class LeadPipelineService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async buildBuyerLeadPipelines(
    leads: BuyerLeadPipelineContext[],
  ): Promise<Map<string, LeadPipelineState>> {
    const byLeadId = new Map<string, LeadPipelineState>();

    for (const lead of leads) {
      byLeadId.set(lead.id, this.buildBuyerLeadPipeline(lead));
    }

    return byLeadId;
  }

  async buildSellerLeadPipelines(
    leads: SellerLeadPipelineContext[],
  ): Promise<Map<string, LeadPipelineState>> {
    const byLeadId = new Map<string, LeadPipelineState>();

    for (const lead of leads) {
      byLeadId.set(lead.id, this.buildSellerLeadPipeline(lead));
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

  private buildBuyerLeadPipeline(
    lead: BuyerLeadPipelineContext,
  ): LeadPipelineState {
    const staleAfterDays = this.getStaleLeadDays();
    const blockers: LeadPipelineBlocker[] = [];
    const warnings: LeadPipelineBlocker[] = [];
    const lastActivityAt = this.resolveLastActivityAt(lead);
    const isClosed = lead.status === 'Won' || lead.status === 'Lost';
    const isStale = !isClosed && this.isStale(lastActivityAt, staleAfterDays);
    const openFollowUps = lead.followUps.filter((followUp) => !followUp.completedAt);
    const completedFollowUps = lead.followUps.filter(
      (followUp) => followUp.completedAt,
    );
    const hasMeaningfulContact = lead.status !== 'New Inquiry';
    const hasUpcomingFollowUp = openFollowUps.some(
      (followUp) => !followUp.completedAt && followUp.dueAt >= new Date(),
    );
    const hasLinkedVehicle = lead.vehicles.length > 0;
    const linkedAvailableVehicle = lead.vehicles.find(
      (vehicle) => vehicle.status !== 'Sold',
    );
    const hasReservedVehicle = lead.vehicles.some(
      (vehicle) => vehicle.status === 'Reserved',
    );
    const hasSoldVehicle = lead.vehicles.some((vehicle) => vehicle.status === 'Sold');
    const hasSale = lead.sales.length > 0;
    const hasContactInfo = Boolean(
      lead.contactNumber.trim() || lead.email || lead.facebookName,
    );

    if (!hasContactInfo) {
      blockers.push({
        code: 'buyer_contact_missing',
        label: 'Missing contact details',
        description: 'Add buyer contact information before progressing this lead.',
        severity: 'critical',
        target: 'lead_edit',
      });
    }

    if (!isClosed && !hasUpcomingFollowUp) {
      warnings.push({
        code: 'buyer_follow_up_missing',
        label: 'No upcoming follow-up',
        description: 'Schedule a follow-up to keep this buyer lead active.',
        severity: 'warning',
        target: 'follow_up',
      });
    }

    if (!isClosed && !hasLinkedVehicle) {
      blockers.push({
        code: 'buyer_vehicle_missing',
        label: 'No linked vehicle',
        description: 'Link a vehicle before reserving this buyer.',
        severity: 'critical',
        target: 'vehicle_link',
      });
    }

    if (hasLinkedVehicle && !linkedAvailableVehicle && !hasSale) {
      blockers.push({
        code: 'buyer_linked_vehicle_unavailable',
        label: 'Linked vehicle unavailable',
        description: 'Review the linked vehicle because it is no longer available.',
        severity: 'critical',
        target: 'vehicle_link',
      });
    }

    if (lead.status === 'Won' && !lead.closingNote?.trim()) {
      blockers.push({
        code: 'buyer_closing_note_missing',
        label: 'Missing closing note',
        description: 'Add the closing note that explains how this sale was won.',
        severity: 'warning',
        target: 'lead_edit',
      });
    }

    if (lead.status === 'Won') {
      blockers.push({
        code: 'buyer_already_won',
        label: 'Lead already won',
        description: 'This buyer is already won and cannot be used for a new sale.',
        severity: 'info',
        target: 'sale_finalization',
      });
    }

    if (isStale) {
      warnings.push({
        code: 'buyer_stale',
        label: 'Stale buyer lead',
        description: `No recent activity has been recorded in the last ${staleAfterDays} days.`,
        severity: 'warning',
        target: 'follow_up',
      });
    }

    let stage = 'new_lead';
    let stageLabel = 'New Lead';
    let progressPercent = 10;

    if (lead.status === 'Lost') {
      stage = 'lost_closed';
      stageLabel = 'Lost / Closed';
      progressPercent = 100;
    } else if (hasSale || lead.status === 'Won') {
      stage = 'won_sale_finalized';
      stageLabel = 'Won / Sale Finalized';
      progressPercent = 100;
    } else if (hasReservedVehicle || lead.status === 'Reserved') {
      stage = 'sale_finalization_pending';
      stageLabel = 'Sale Finalization Pending';
      progressPercent = 85;
    } else if (hasLinkedVehicle && linkedAvailableVehicle) {
      stage = blockers.some((blocker) => blocker.code === 'buyer_vehicle_missing')
        ? 'vehicle_matched'
        : 'ready_to_reserve';
      stageLabel = stage === 'ready_to_reserve' ? 'Ready to Reserve' : 'Vehicle Matched';
      progressPercent = stage === 'ready_to_reserve' ? 65 : 50;
    } else if (hasMeaningfulContact || lead.followUps.length > 0) {
      stage = 'contacted_follow_up';
      stageLabel = 'Contacted / In Follow-up';
      progressPercent = 30;
    }

    let nextAction: LeadPipelineNextAction | null = null;

    if (stage === 'won_sale_finalized' || stage === 'lost_closed') {
      nextAction = null;
    } else if (isStale) {
      nextAction = {
        code: 'review_stale_lead',
        label: 'Review stale lead',
        description: 'Reconnect with this buyer lead and confirm whether it should still progress.',
        target: 'follow_up',
      };
    } else if (!hasUpcomingFollowUp) {
      nextAction = {
        code: 'schedule_follow_up',
        label: 'Schedule follow-up',
        description: 'Schedule a follow-up to keep this buyer lead moving.',
        target: 'follow_up',
      };
    } else if (!hasLinkedVehicle) {
      nextAction = {
        code: 'link_vehicle',
        label: 'Link a vehicle',
        description: 'Match this buyer with an available vehicle before reserving.',
        target: 'vehicle_link',
      };
    } else if (!hasReservedVehicle) {
      nextAction = {
        code: 'review_linked_vehicle',
        label: 'Review linked vehicle',
        description: 'Review the linked vehicle and confirm whether this buyer is ready to reserve.',
        target: 'vehicle_link',
      };
    } else {
      nextAction = {
        code: 'finalize_sale',
        label: 'Finalize sale',
        description: 'Complete the sale workflow for this reserved buyer and vehicle.',
        target: 'sale_finalization',
      };
    }

    return {
      stage,
      stageLabel,
      progressPercent,
      nextAction,
      blockers,
      warnings,
      lastActivityAt,
      isStale,
      context: {
        openFollowUpCount: openFollowUps.length,
        latestFollowUpAt: this.getLatestDate(openFollowUps.map((followUp) => followUp.dueAt)),
        latestCompletedFollowUpAt: this.getLatestDate(
          completedFollowUps
            .map((followUp) => followUp.completedAt)
            .filter((value): value is Date => value instanceof Date),
        ),
        linkedVehicleCount: lead.vehicles.length,
        availableLinkedVehicleCount: lead.vehicles.filter(
          (vehicle) => vehicle.status === 'Available',
        ).length,
        reservedLinkedVehicleCount: lead.vehicles.filter(
          (vehicle) => vehicle.status === 'Reserved',
        ).length,
        soldLinkedVehicleCount: lead.vehicles.filter(
          (vehicle) => vehicle.status === 'Sold',
        ).length,
        finalizedSaleCount: lead.sales.length,
        staleAfterDays,
      },
    };
  }

  private buildSellerLeadPipeline(
    lead: SellerLeadPipelineContext,
  ): LeadPipelineState {
    const staleAfterDays = this.getStaleLeadDays();
    const blockers: LeadPipelineBlocker[] = [];
    const warnings: LeadPipelineBlocker[] = [];
    const lastActivityAt = this.resolveLastActivityAt(lead);
    const isClosed = lead.status === 'Purchased' || lead.status === 'Rejected';
    const isStale = !isClosed && this.isStale(lastActivityAt, staleAfterDays);
    const openFollowUps = lead.followUps.filter((followUp) => !followUp.completedAt);
    const completedFollowUps = lead.followUps.filter(
      (followUp) => followUp.completedAt,
    );
    const hasUpcomingFollowUp = openFollowUps.some(
      (followUp) => !followUp.completedAt && followUp.dueAt >= new Date(),
    );
    const hasVehicleDetails = Boolean(
      lead.vehicleBrand.trim() &&
        lead.vehicleModel.trim() &&
        lead.vehicleYear !== null,
    );
    const hasPricing = Boolean(lead.targetBuyPrice || lead.askingPrice);
    const readyForReview =
      hasVehicleDetails &&
      hasPricing &&
      (lead.status === 'Evaluated' ||
        lead.status === 'Negotiating' ||
        lead.status === 'Approved to Buy');

    if (!lead.contactNumber.trim() && !lead.email && !lead.facebookName) {
      blockers.push({
        code: 'seller_contact_missing',
        label: 'Missing contact details',
        description: 'Add seller contact information before progressing this lead.',
        severity: 'critical',
        target: 'lead_edit',
      });
    }

    if (!hasUpcomingFollowUp && !isClosed) {
      warnings.push({
        code: 'seller_follow_up_missing',
        label: 'No upcoming follow-up',
        description: 'Schedule a follow-up to keep this seller lead active.',
        severity: 'warning',
        target: 'follow_up',
      });
    }

    if (!hasVehicleDetails) {
      blockers.push({
        code: 'seller_vehicle_details_missing',
        label: 'Vehicle details incomplete',
        description: 'Complete the brand, model, and year before acquisition review.',
        severity: 'critical',
        target: 'lead_edit',
      });
    }

    if (hasVehicleDetails && !hasPricing && lead.status !== 'Purchased') {
      blockers.push({
        code: 'seller_pricing_missing',
        label: 'Pricing details missing',
        description: 'Add the asking or target buy price before acquisition review.',
        severity: 'critical',
        target: 'lead_edit',
      });
    }

    if (lead.status === 'Purchased' || lead.vehicleId) {
      blockers.push({
        code: 'seller_already_converted',
        label: 'Lead already converted',
        description: 'This seller lead has already resulted in an inventory vehicle.',
        severity: 'info',
        target: 'vehicle_create',
      });
    }

    if (lead.status === 'Rejected') {
      blockers.push({
        code: 'seller_closed',
        label: 'Lead closed',
        description: 'This seller lead is closed and should not move forward.',
        severity: 'info',
      });
    }

    if (isStale) {
      warnings.push({
        code: 'seller_stale',
        label: 'Stale seller lead',
        description: `No recent activity has been recorded in the last ${staleAfterDays} days.`,
        severity: 'warning',
        target: 'follow_up',
      });
    }

    let stage = 'new_seller_lead';
    let stageLabel = 'New Seller Lead';
    let progressPercent = 10;

    if (lead.status === 'Rejected') {
      stage = 'rejected_closed';
      stageLabel = 'Rejected / Closed';
      progressPercent = 100;
    } else if (lead.status === 'Purchased' || lead.vehicleId) {
      stage = 'acquired_vehicle_created';
      stageLabel = 'Acquired / Vehicle Created';
      progressPercent = 100;
    } else if (readyForReview) {
      stage = 'acquisition_review';
      stageLabel = 'Acquisition Review';
      progressPercent = 70;
    } else if (hasVehicleDetails) {
      stage = 'vehicle_details_captured';
      stageLabel = 'Vehicle Details Captured';
      progressPercent = 45;
    } else if (lead.followUps.length > 0 || lead.status !== 'New Inquiry') {
      stage = 'contacted_follow_up';
      stageLabel = 'Contacted / In Follow-up';
      progressPercent = 25;
    }

    let nextAction: LeadPipelineNextAction | null = null;

    if (stage === 'acquired_vehicle_created' || stage === 'rejected_closed') {
      nextAction = null;
    } else if (isStale) {
      nextAction = {
        code: 'review_stale_seller_lead',
        label: 'Review stale seller lead',
        description: 'Reconnect with this seller and confirm whether acquisition should continue.',
        target: 'follow_up',
      };
    } else if (!hasUpcomingFollowUp) {
      nextAction = {
        code: 'schedule_follow_up',
        label: 'Schedule follow-up',
        description: 'Schedule a follow-up to keep this seller lead moving.',
        target: 'follow_up',
      };
    } else if (!hasVehicleDetails || !hasPricing) {
      nextAction = {
        code: 'complete_vehicle_details',
        label: 'Complete vehicle details',
        description: 'Fill in the missing vehicle and pricing details needed for review.',
        target: 'lead_edit',
      };
    } else if (lead.status !== 'Approved to Buy') {
      nextAction = {
        code: 'review_acquisition_pricing',
        label: 'Review acquisition pricing',
        description: 'Review the pricing and inspection details before approving this acquisition.',
        target: 'lead_edit',
      };
    } else {
      nextAction = {
        code: 'create_inventory_vehicle',
        label: 'Create inventory vehicle',
        description: 'Convert this approved seller lead into an inventory vehicle record.',
        target: 'vehicle_create',
      };
    }

    return {
      stage,
      stageLabel,
      progressPercent,
      nextAction,
      blockers,
      warnings,
      lastActivityAt,
      isStale,
      context: {
        openFollowUpCount: openFollowUps.length,
        latestFollowUpAt: this.getLatestDate(openFollowUps.map((followUp) => followUp.dueAt)),
        latestCompletedFollowUpAt: this.getLatestDate(
          completedFollowUps
            .map((followUp) => followUp.completedAt)
            .filter((value): value is Date => value instanceof Date),
        ),
        vehicleCreated: Boolean(lead.vehicleId),
        staleAfterDays,
      },
    };
  }

  private resolveLastActivityAt(lead: {
    latestActivityAt: Date | null;
    updatedAt: Date;
    createdAt: Date;
  }) {
    return lead.latestActivityAt ?? lead.updatedAt ?? lead.createdAt ?? null;
  }

  private isStale(lastActivityAt: Date | null, staleAfterDays: number) {
    if (!lastActivityAt) {
      return true;
    }

    return Date.now() - lastActivityAt.getTime() >= staleAfterDays * 24 * 60 * 60 * 1000;
  }

  private getStaleLeadDays() {
    const rawValue = process.env.LEAD_PIPELINE_STALE_DAYS?.trim();
    const parsed = rawValue ? Number(rawValue) : 7;

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 7;
    }

    return Math.floor(parsed);
  }

  private getLatestDate(dates: Date[]) {
    if (dates.length === 0) {
      return null;
    }

    return dates.reduce((latest, current) =>
      current.getTime() > latest.getTime() ? current : latest,
    );
  }
}
