import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import {
  buildPaginatedResponse,
  normalizeSearch,
  parsePagination,
} from '../../common/utils/list-query.utils';
import type { CurrentUser } from '../../common/types/auth.types';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { ActivityHistoryService } from '../activity-history/activity-history.service';
import { LeadPipelineService } from '../lead-pipeline/lead-pipeline.service';
import {
  mapBuyerLeadResponse,
  parseBuyerLeadStatus,
} from './buyer_leads.helpers';
import { CreateBuyerLeadDto } from './dto/create-buyer_lead.dto';
import { ListBuyerLeadsQueryDto } from './dto/list-buyer-leads-query.dto';
import { UpdateBuyerLeadDto } from './dto/update-buyer_lead.dto';

@Injectable()
export class BuyerLeadsService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly activityHistoryService: ActivityHistoryService,
    private readonly leadPipelineService: LeadPipelineService,
  ) {}

  async create(user: CurrentUser, createBuyerLeadDto: CreateBuyerLeadDto) {
    const insertedLead = await this.db
      .insertInto('crm.buyer_leads')
      .values({
        buyer_name: this.requireNonEmpty(
          createBuyerLeadDto.buyerName,
          'buyerName',
        ),
        contact_number: this.requireNonEmpty(
          createBuyerLeadDto.contactNumber,
          'contactNumber',
        ),
        email: createBuyerLeadDto.email ?? null,
        facebook_name: createBuyerLeadDto.facebookName ?? null,
        inquiry_source: createBuyerLeadDto.inquirySource ?? null,
        desired_budget: createBuyerLeadDto.desiredBudget ?? null,
        notes: createBuyerLeadDto.notes ?? null,
        status: parseBuyerLeadStatus(createBuyerLeadDto.status, 'New Inquiry'),
        assignee_user_id: createBuyerLeadDto.assigneeUserId ?? null,
        closing_note: createBuyerLeadDto.closingNote ?? null,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    await this.activityHistoryService.write({
      actor: user,
      entityType: 'buyer_lead',
      entityId: insertedLead.id,
      actionType: 'buyer_lead.created',
      summary: 'Buyer lead created',
      metadata: {
        buyerName: createBuyerLeadDto.buyerName,
        status: parseBuyerLeadStatus(createBuyerLeadDto.status, 'New Inquiry'),
        assigneeUserId: createBuyerLeadDto.assigneeUserId ?? null,
      },
    });

    return { buyerLead: await this.getBuyerLeadOrThrow(insertedLead.id) };
  }

  async findAll(query: ListBuyerLeadsQueryDto = {}) {
    const pagination = parsePagination(query);
    const search = normalizeSearch(query.search);
    const status = query.status ? parseBuyerLeadStatus(query.status, 'New Inquiry') : undefined;
    const eligibleForSale = this.parseBooleanQuery(query.eligibleForSale);
    const sort = this.parseSort(query.sortBy, query.sortOrder);

    let buyerLeadsQuery = this.db.selectFrom('crm.buyer_leads');

    if (status) {
      buyerLeadsQuery = buyerLeadsQuery.where('status', '=', status);
    }

    if (eligibleForSale) {
      buyerLeadsQuery = buyerLeadsQuery.where('status', '!=', 'Won');
    }

    if (search) {
      const pattern = `%${search.toLowerCase()}%`;
      buyerLeadsQuery = buyerLeadsQuery.where(({ eb, or }) =>
        or([
          eb(sql<string>`lower(buyer_name)`, 'like', pattern),
          eb(sql<string>`lower(contact_number)`, 'like', pattern),
          eb(sql<string>`lower(coalesce(email, ''))`, 'like', pattern),
          eb(sql<string>`coalesce(desired_budget::text, '')`, 'like', pattern),
        ]),
      );
    }

    let total = 0;
    let buyerLeadItems: Awaited<ReturnType<BuyerLeadsService['mapBuyerLeadList']>> = [];

    if (query.pipelineState) {
      const allLeads = await buyerLeadsQuery
        .selectAll()
        .orderBy(sort.column, sort.direction)
        .execute();
      const allMappedLeads = await this.mapBuyerLeadList(allLeads);
      const filteredLeads = this.leadPipelineService.filterByPipelineState(
        'buyer',
        allMappedLeads,
        query.pipelineState,
      );
      total = filteredLeads.length;
      buyerLeadItems = filteredLeads.slice(
        pagination.offset,
        pagination.offset + pagination.pageSize,
      );
    } else {
      const totalRow = await buyerLeadsQuery
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow();
      total = Number(totalRow.count);

      const leads = await buyerLeadsQuery
        .selectAll()
        .orderBy(sort.column, sort.direction)
        .offset(pagination.offset)
        .limit(pagination.pageSize)
        .execute();

      buyerLeadItems = await this.mapBuyerLeadList(leads);
    }

    const response = buildPaginatedResponse(buyerLeadItems, pagination, total);

    return {
      buyerLeads: response.items,
      page: response.page,
      pageSize: response.pageSize,
      total: response.total,
      totalPages: response.totalPages,
    };
  }

  async findOne(id: string) {
    return { buyerLead: await this.getBuyerLeadOrThrow(id) };
  }

  async update(user: CurrentUser, id: string, updateBuyerLeadDto: UpdateBuyerLeadDto) {
    const existingLead = await this.getLeadRecordOrThrow(id);
    const nextStatus = updateBuyerLeadDto.status
      ? parseBuyerLeadStatus(updateBuyerLeadDto.status, 'New Inquiry')
      : parseBuyerLeadStatus(existingLead.status, 'New Inquiry');

    const nextAssigneeUserId =
      updateBuyerLeadDto.assigneeUserId !== undefined
        ? (updateBuyerLeadDto.assigneeUserId ?? null)
        : existingLead.assignee_user_id;
    const nextBuyerName =
      updateBuyerLeadDto.buyerName !== undefined
        ? this.requireNonEmpty(updateBuyerLeadDto.buyerName, 'buyerName')
        : existingLead.buyer_name;
    const nextContactNumber =
      updateBuyerLeadDto.contactNumber !== undefined
        ? this.requireNonEmpty(
            updateBuyerLeadDto.contactNumber,
            'contactNumber',
          )
        : existingLead.contact_number;
    const nextClosingNote =
      updateBuyerLeadDto.closingNote !== undefined
        ? (updateBuyerLeadDto.closingNote ?? null)
        : existingLead.closing_note;

    if (nextStatus !== 'New Inquiry') {
      if (!nextAssigneeUserId || !nextBuyerName || !nextContactNumber) {
        throw new BadRequestException(
          'Buyer lead requires buyerName, contactNumber, and assigneeUserId before leaving New Inquiry',
        );
      }
    }

    if (
      (nextStatus === 'Won' || nextStatus === 'Lost') &&
      !nextClosingNote?.trim()
    ) {
      throw new BadRequestException(
        'closingNote is required for Won and Lost buyer leads',
      );
    }

    await this.db
      .updateTable('crm.buyer_leads')
      .set({
        ...(updateBuyerLeadDto.buyerName !== undefined
          ? { buyer_name: nextBuyerName }
          : {}),
        ...(updateBuyerLeadDto.contactNumber !== undefined
          ? { contact_number: nextContactNumber }
          : {}),
        ...(updateBuyerLeadDto.email !== undefined
          ? { email: updateBuyerLeadDto.email ?? null }
          : {}),
        ...(updateBuyerLeadDto.facebookName !== undefined
          ? { facebook_name: updateBuyerLeadDto.facebookName ?? null }
          : {}),
        ...(updateBuyerLeadDto.inquirySource !== undefined
          ? { inquiry_source: updateBuyerLeadDto.inquirySource ?? null }
          : {}),
        ...(updateBuyerLeadDto.desiredBudget !== undefined
          ? { desired_budget: updateBuyerLeadDto.desiredBudget ?? null }
          : {}),
        ...(updateBuyerLeadDto.notes !== undefined
          ? { notes: updateBuyerLeadDto.notes ?? null }
          : {}),
        ...(updateBuyerLeadDto.status !== undefined
          ? { status: nextStatus }
          : {}),
        ...(updateBuyerLeadDto.assigneeUserId !== undefined
          ? { assignee_user_id: nextAssigneeUserId }
          : {}),
        ...(updateBuyerLeadDto.closingNote !== undefined
          ? { closing_note: nextClosingNote }
          : {}),
        latest_activity_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    await this.writeUpdateActivity(user, existingLead, {
      status: nextStatus,
      assignee_user_id: nextAssigneeUserId,
      buyer_name: nextBuyerName,
      contact_number: nextContactNumber,
      desired_budget:
        updateBuyerLeadDto.desiredBudget !== undefined
          ? updateBuyerLeadDto.desiredBudget ?? null
          : existingLead.desired_budget,
      inquiry_source:
        updateBuyerLeadDto.inquirySource !== undefined
          ? updateBuyerLeadDto.inquirySource ?? null
          : existingLead.inquiry_source,
      notes: updateBuyerLeadDto.notes !== undefined ? updateBuyerLeadDto.notes ?? null : existingLead.notes,
      closing_note: nextClosingNote,
    });

    return { buyerLead: await this.getBuyerLeadOrThrow(id) };
  }

  private async writeUpdateActivity(
    user: CurrentUser,
    previous: Awaited<ReturnType<BuyerLeadsService['getLeadRecordOrThrow']>>,
    next: {
      status: string;
      assignee_user_id: string | null;
      buyer_name: string;
      contact_number: string;
      desired_budget: string | null;
      inquiry_source: string | null;
      notes: string | null;
      closing_note: string | null;
    },
  ) {
    const events: Promise<void>[] = [];

    if (previous.status !== next.status) {
      events.push(
        this.activityHistoryService.write({
          actor: user,
          entityType: 'buyer_lead',
          entityId: previous.id,
          actionType: 'buyer_lead.status_changed',
          summary: `Buyer lead moved from ${previous.status} to ${next.status}`,
          metadata: { from: previous.status, to: next.status },
        }),
      );
    }

    if (previous.assignee_user_id !== next.assignee_user_id) {
      events.push(
        this.activityHistoryService.write({
          actor: user,
          entityType: 'buyer_lead',
          entityId: previous.id,
          actionType: 'buyer_lead.assignment_changed',
          summary: next.assignee_user_id ? 'Buyer lead assignment changed' : 'Buyer lead unassigned',
          metadata: { from: previous.assignee_user_id, to: next.assignee_user_id },
        }),
      );
    }

    if (previous.closing_note !== next.closing_note) {
      events.push(
        this.activityHistoryService.write({
          actor: user,
          entityType: 'buyer_lead',
          entityId: previous.id,
          actionType: 'buyer_lead.closing_note_updated',
          summary: previous.closing_note ? 'Buyer closing note updated' : 'Buyer closing note added',
          metadata: { hadClosingNote: Boolean(previous.closing_note), hasClosingNote: Boolean(next.closing_note) },
        }),
      );
    }

    if (
      previous.buyer_name !== next.buyer_name ||
      previous.contact_number !== next.contact_number ||
      previous.desired_budget !== next.desired_budget ||
      previous.inquiry_source !== next.inquiry_source ||
      previous.notes !== next.notes
    ) {
      events.push(
        this.activityHistoryService.write({
          actor: user,
          entityType: 'buyer_lead',
          entityId: previous.id,
          actionType: 'buyer_lead.details_updated',
          summary: 'Buyer lead details updated',
          metadata: {
            changedFields: [
              previous.buyer_name !== next.buyer_name ? 'buyerName' : null,
              previous.contact_number !== next.contact_number ? 'contactNumber' : null,
              previous.desired_budget !== next.desired_budget ? 'desiredBudget' : null,
              previous.inquiry_source !== next.inquiry_source ? 'inquirySource' : null,
              previous.notes !== next.notes ? 'notes' : null,
            ].filter(Boolean),
          },
        }),
      );
    }

    await Promise.all(events);
  }

  private async getBuyerLeadOrThrow(id: string) {
    const lead = await this.getLeadRecordOrThrow(id);
    const [vehicles, pipelineContext] = await Promise.all([
      this.getVehicleSummariesForBuyerLeadIds([id]),
      this.leadPipelineService.getBuyerLeadPipelineContext([id]),
    ]);
    const pipelineByLeadId = await this.leadPipelineService.buildBuyerLeadPipelines([
      {
        id: lead.id,
        status: parseBuyerLeadStatus(lead.status, 'New Inquiry'),
        contactNumber: lead.contact_number,
        email: lead.email,
        facebookName: lead.facebook_name,
        assigneeUserId: lead.assignee_user_id,
        closingNote: lead.closing_note,
        latestActivityAt: lead.latest_activity_at,
        createdAt: lead.created_at,
        updatedAt: lead.updated_at,
        vehicles: pipelineContext.get(lead.id)?.vehicles ?? [],
        followUps: pipelineContext.get(lead.id)?.followUps ?? [],
        sales: pipelineContext.get(lead.id)?.sales ?? [],
      },
    ]);

    return mapBuyerLeadResponse({
      ...lead,
      status: parseBuyerLeadStatus(lead.status, 'New Inquiry'),
      vehicles: vehicles.get(id) ?? [],
      pipeline: pipelineByLeadId.get(id),
    });
  }

  private async getLeadRecordOrThrow(id: string) {
    const lead = await this.db
      .selectFrom('crm.buyer_leads')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!lead) {
      throw new NotFoundException(`Buyer lead ${id} was not found`);
    }

    return lead;
  }

  private requireNonEmpty(value: string, field: string) {
    const trimmed = value?.trim();

    if (!trimmed) {
      throw new BadRequestException(`${field} is required`);
    }

    return trimmed;
  }

  private async mapBuyerLeadList(
    leads: Array<{
      id: string
      buyer_name: string
      contact_number: string
      email: string | null
      facebook_name: string | null
      inquiry_source: string | null
      desired_budget: string | null
      notes: string | null
      status: string
      assignee_user_id: string | null
      latest_activity_at: Date | null
      closing_note: string | null
      created_at: Date
      updated_at: Date
    }>,
  ) {
    const leadIds = leads.map((lead) => lead.id);
    const [vehicleMap, pipelineContext] = await Promise.all([
      this.getVehicleSummariesForBuyerLeadIds(leadIds),
      this.leadPipelineService.getBuyerLeadPipelineContext(leadIds),
    ]);
    const pipelineByLeadId = await this.leadPipelineService.buildBuyerLeadPipelines(
      leads.map((lead) => ({
        id: lead.id,
        status: parseBuyerLeadStatus(lead.status, 'New Inquiry'),
        contactNumber: lead.contact_number,
        email: lead.email,
        facebookName: lead.facebook_name,
        assigneeUserId: lead.assignee_user_id,
        closingNote: lead.closing_note,
        latestActivityAt: lead.latest_activity_at,
        createdAt: lead.created_at,
        updatedAt: lead.updated_at,
        vehicles: pipelineContext.get(lead.id)?.vehicles ?? [],
        followUps: pipelineContext.get(lead.id)?.followUps ?? [],
        sales: pipelineContext.get(lead.id)?.sales ?? [],
      })),
    );

    return leads.map((lead) =>
      mapBuyerLeadResponse({
        ...lead,
        status: parseBuyerLeadStatus(lead.status, 'New Inquiry'),
        vehicles: vehicleMap.get(lead.id) ?? [],
        pipeline: pipelineByLeadId.get(lead.id),
      }),
    );
  }

  private async getVehicleSummariesForBuyerLeadIds(buyerLeadIds: string[]) {
    const byLeadId = new Map<string, BuyerLeadVehicleSummary[]>();

    if (buyerLeadIds.length === 0) {
      return byLeadId;
    }

    const vehicles = await this.db
      .selectFrom('crm.lead_vehicle_links')
      .innerJoin(
        'inventory.vehicles',
        'inventory.vehicles.id',
        'crm.lead_vehicle_links.vehicle_id',
      )
      .select([
        'crm.lead_vehicle_links.buyer_lead_id as buyerLeadId',
        'inventory.vehicles.id as id',
        'inventory.vehicles.stock_number as stockNumber',
        'inventory.vehicles.brand as brand',
        'inventory.vehicles.model as model',
        'inventory.vehicles.year as year',
        'inventory.vehicles.status as status',
      ])
      .where('crm.lead_vehicle_links.buyer_lead_id', 'in', buyerLeadIds)
      .orderBy('crm.lead_vehicle_links.created_at', 'asc')
      .execute();

    for (const vehicle of vehicles) {
      const current = byLeadId.get(vehicle.buyerLeadId) ?? [];
      current.push({
        id: vehicle.id,
        stockNumber: vehicle.stockNumber,
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
        status: vehicle.status,
      });
      byLeadId.set(vehicle.buyerLeadId, current);
    }

    return byLeadId;
  }

  private parseSort(sortBy?: string, sortOrder?: string) {
    const direction = this.parseSortOrder(sortOrder);

    switch (sortBy) {
      case undefined:
      case 'updatedAt':
        return { column: 'updated_at' as const, direction };
      case 'createdAt':
        return { column: 'created_at' as const, direction };
      case 'buyerName':
        return { column: 'buyer_name' as const, direction };
      case 'status':
        return { column: 'status' as const, direction };
      case 'desiredBudget':
        return { column: 'desired_budget' as const, direction };
      default:
        throw new BadRequestException(`Unsupported buyer lead sort: ${sortBy}`);
    }
  }

  private parseSortOrder(sortOrder?: string): 'asc' | 'desc' {
    if (!sortOrder || sortOrder === 'desc') {
      return 'desc';
    }

    if (sortOrder === 'asc') {
      return 'asc';
    }

    throw new BadRequestException(`Unsupported sort order: ${sortOrder}`);
  }

  private parseBooleanQuery(value?: boolean | string) {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value !== 'string') {
      return false;
    }

    return value.toLowerCase() === 'true';
  }

}

type BuyerLeadVehicleSummary = {
  id: string;
  stockNumber: string;
  brand: string;
  model: string;
  year: number;
  status: string;
};
