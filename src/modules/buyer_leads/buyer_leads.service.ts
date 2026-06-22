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
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { mapBuyerLeadResponse, parseBuyerLeadStatus } from './buyer_leads.helpers';
import { CreateBuyerLeadDto } from './dto/create-buyer_lead.dto';
import { ListBuyerLeadsQueryDto } from './dto/list-buyer-leads-query.dto';
import { LinkBuyerLeadVehicleDto } from './dto/link-buyer-lead-vehicle.dto';
import { UpdateBuyerLeadDto } from './dto/update-buyer_lead.dto';

@Injectable()
export class BuyerLeadsService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async create(createBuyerLeadDto: CreateBuyerLeadDto) {
    const insertedLead = await this.db
      .insertInto('crm.buyer_leads')
      .values({
        buyer_name: this.requireNonEmpty(createBuyerLeadDto.buyerName, 'buyerName'),
        contact_number: this.requireNonEmpty(createBuyerLeadDto.contactNumber, 'contactNumber'),
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

    const totalRow = await buyerLeadsQuery
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const total = Number(totalRow.count);

    const leads = await buyerLeadsQuery
      .selectAll()
      .orderBy(sort.column, sort.direction)
      .offset(pagination.offset)
      .limit(pagination.pageSize)
      .execute();

    const response = buildPaginatedResponse(
      await this.mapBuyerLeadList(leads),
      pagination,
      total,
    );

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

  async update(id: string, updateBuyerLeadDto: UpdateBuyerLeadDto) {
    const existingLead = await this.getLeadRecordOrThrow(id);
    const nextStatus = updateBuyerLeadDto.status
      ? parseBuyerLeadStatus(updateBuyerLeadDto.status, 'New Inquiry')
      : parseBuyerLeadStatus(existingLead.status, 'New Inquiry');

    const nextAssigneeUserId =
      updateBuyerLeadDto.assigneeUserId !== undefined
        ? updateBuyerLeadDto.assigneeUserId ?? null
        : existingLead.assignee_user_id;
    const nextBuyerName =
      updateBuyerLeadDto.buyerName !== undefined
        ? this.requireNonEmpty(updateBuyerLeadDto.buyerName, 'buyerName')
        : existingLead.buyer_name;
    const nextContactNumber =
      updateBuyerLeadDto.contactNumber !== undefined
        ? this.requireNonEmpty(updateBuyerLeadDto.contactNumber, 'contactNumber')
        : existingLead.contact_number;
    const nextClosingNote =
      updateBuyerLeadDto.closingNote !== undefined
        ? updateBuyerLeadDto.closingNote ?? null
        : existingLead.closing_note;

    if (nextStatus !== 'New Inquiry') {
      if (!nextAssigneeUserId || !nextBuyerName || !nextContactNumber) {
        throw new BadRequestException(
          'Buyer lead requires buyerName, contactNumber, and assigneeUserId before leaving New Inquiry',
        );
      }
    }

    if ((nextStatus === 'Won' || nextStatus === 'Lost') && !nextClosingNote?.trim()) {
      throw new BadRequestException('closingNote is required for Won and Lost buyer leads');
    }

    if (nextStatus === 'Reserved') {
      const links = await this.db
        .selectFrom('crm.lead_vehicle_links')
        .select(['id'])
        .where('buyer_lead_id', '=', id)
        .execute();

      if (links.length === 0) {
        throw new BadRequestException(
          'A buyer lead must have at least one linked vehicle before becoming Reserved',
        );
      }
    }

    await this.db
      .updateTable('crm.buyer_leads')
      .set({
        ...(updateBuyerLeadDto.buyerName !== undefined ? { buyer_name: nextBuyerName } : {}),
        ...(updateBuyerLeadDto.contactNumber !== undefined
          ? { contact_number: nextContactNumber }
          : {}),
        ...(updateBuyerLeadDto.email !== undefined ? { email: updateBuyerLeadDto.email ?? null } : {}),
        ...(updateBuyerLeadDto.facebookName !== undefined
          ? { facebook_name: updateBuyerLeadDto.facebookName ?? null }
          : {}),
        ...(updateBuyerLeadDto.inquirySource !== undefined
          ? { inquiry_source: updateBuyerLeadDto.inquirySource ?? null }
          : {}),
        ...(updateBuyerLeadDto.desiredBudget !== undefined
          ? { desired_budget: updateBuyerLeadDto.desiredBudget ?? null }
          : {}),
        ...(updateBuyerLeadDto.notes !== undefined ? { notes: updateBuyerLeadDto.notes ?? null } : {}),
        ...(updateBuyerLeadDto.status !== undefined ? { status: nextStatus } : {}),
        ...(updateBuyerLeadDto.assigneeUserId !== undefined
          ? { assignee_user_id: nextAssigneeUserId }
          : {}),
        ...(updateBuyerLeadDto.closingNote !== undefined ? { closing_note: nextClosingNote } : {}),
        latest_activity_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    return { buyerLead: await this.getBuyerLeadOrThrow(id) };
  }

  async linkVehicle(id: string, dto: LinkBuyerLeadVehicleDto) {
    await this.getLeadRecordOrThrow(id);

    const vehicle = await this.db
      .selectFrom('inventory.vehicles')
      .select(['id'])
      .where('id', '=', dto.vehicleId)
      .executeTakeFirst();

    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${dto.vehicleId} was not found`);
    }

    const existingLink = await this.db
      .selectFrom('crm.lead_vehicle_links')
      .select(['id'])
      .where('buyer_lead_id', '=', id)
      .where('vehicle_id', '=', dto.vehicleId)
      .executeTakeFirst();

    if (existingLink) {
      throw new BadRequestException('Vehicle is already linked to this buyer lead');
    }

    await this.db
      .insertInto('crm.lead_vehicle_links')
      .values({
        buyer_lead_id: id,
        vehicle_id: dto.vehicleId,
      })
      .execute();

    return { buyerLead: await this.getBuyerLeadOrThrow(id) };
  }

  async unlinkVehicle(id: string, vehicleId: string) {
    await this.getLeadRecordOrThrow(id);

    const deleted = await this.db
      .deleteFrom('crm.lead_vehicle_links')
      .where('buyer_lead_id', '=', id)
      .where('vehicle_id', '=', vehicleId)
      .executeTakeFirst();

    if (!deleted.numDeletedRows || Number(deleted.numDeletedRows) === 0) {
      throw new NotFoundException(`Vehicle ${vehicleId} is not linked to buyer lead ${id}`);
    }

    return { buyerLead: await this.getBuyerLeadOrThrow(id) };
  }

  private async getBuyerLeadOrThrow(id: string) {
    const lead = await this.getLeadRecordOrThrow(id);
    const vehicles = await this.getVehicleSummariesForBuyerLeadIds([id]);

    return mapBuyerLeadResponse({
      ...lead,
      status: parseBuyerLeadStatus(lead.status, 'New Inquiry'),
      vehicles: vehicles.get(id) ?? [],
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
    const vehicleMap = await this.getVehicleSummariesForBuyerLeadIds(leads.map((lead) => lead.id));

    return leads.map((lead) =>
      mapBuyerLeadResponse({
        ...lead,
        status: parseBuyerLeadStatus(lead.status, 'New Inquiry'),
        vehicles: vehicleMap.get(lead.id) ?? [],
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
