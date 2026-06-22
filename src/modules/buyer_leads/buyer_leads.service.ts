import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import {
  mapBuyerLeadResponse,
  parseBuyerLeadStatus,
} from './buyer_leads.helpers';
import { CreateBuyerLeadDto } from './dto/create-buyer_lead.dto';
import { LinkBuyerLeadVehicleDto } from './dto/link-buyer-lead-vehicle.dto';
import { UpdateBuyerLeadDto } from './dto/update-buyer_lead.dto';

@Injectable()
export class BuyerLeadsService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async create(createBuyerLeadDto: CreateBuyerLeadDto) {
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

    return { buyerLead: await this.getBuyerLeadOrThrow(insertedLead.id) };
  }

  async findAll() {
    const buyerLeads = await this.db
      .selectFrom('crm.buyer_leads')
      .select(['id'])
      .orderBy('created_at', 'desc')
      .execute();

    return {
      buyerLeads: await Promise.all(
        buyerLeads.map((lead) => this.getBuyerLeadOrThrow(lead.id)),
      ),
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
      throw new BadRequestException(
        'Vehicle is already linked to this buyer lead',
      );
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
      throw new NotFoundException(
        `Vehicle ${vehicleId} is not linked to buyer lead ${id}`,
      );
    }

    return { buyerLead: await this.getBuyerLeadOrThrow(id) };
  }

  private async getBuyerLeadOrThrow(id: string) {
    const lead = await this.getLeadRecordOrThrow(id);
    const vehicles = await this.db
      .selectFrom('crm.lead_vehicle_links')
      .innerJoin(
        'inventory.vehicles',
        'inventory.vehicles.id',
        'crm.lead_vehicle_links.vehicle_id',
      )
      .select([
        'inventory.vehicles.id as id',
        'inventory.vehicles.stock_number as stockNumber',
        'inventory.vehicles.brand as brand',
        'inventory.vehicles.model as model',
        'inventory.vehicles.year as year',
        'inventory.vehicles.status as status',
      ])
      .where('crm.lead_vehicle_links.buyer_lead_id', '=', id)
      .orderBy('crm.lead_vehicle_links.created_at', 'asc')
      .execute();

    return mapBuyerLeadResponse({
      ...lead,
      status: parseBuyerLeadStatus(lead.status, 'New Inquiry'),
      vehicles,
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
}
