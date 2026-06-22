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
import { CompleteFollowUpDto } from './dto/complete-follow-up.dto';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { ListFollowUpsQueryDto } from './dto/list-follow-ups-query.dto';
import { mapFollowUpResponse, parseFollowUpStatus, parseLeadType } from './follow-ups.helpers';

@Injectable()
export class FollowUpsService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async create(dto: CreateFollowUpDto) {
    const leadType = parseLeadType(dto.leadType);
    const note = dto.note?.trim();

    if (!dto.assigneeUserId) {
      throw new BadRequestException('assigneeUserId is required');
    }

    if (!dto.dueAt) {
      throw new BadRequestException('dueAt is required');
    }

    if (!note) {
      throw new BadRequestException('note is required');
    }

    if (leadType === 'buyer') {
      if (!dto.buyerLeadId || dto.sellerLeadId) {
        throw new BadRequestException('buyer lead follow-up must include only buyerLeadId');
      }

      await this.ensureBuyerLeadExists(dto.buyerLeadId);
    }

    if (leadType === 'seller') {
      if (!dto.sellerLeadId || dto.buyerLeadId) {
        throw new BadRequestException('seller lead follow-up must include only sellerLeadId');
      }

      await this.ensureSellerLeadExists(dto.sellerLeadId);
    }

    const inserted = await this.db
      .insertInto('crm.follow_ups')
      .values({
        lead_type: leadType,
        seller_lead_id: dto.sellerLeadId ?? null,
        buyer_lead_id: dto.buyerLeadId ?? null,
        assignee_user_id: dto.assigneeUserId,
        due_at: new Date(dto.dueAt),
        status: 'Due',
        note,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    return { followUp: await this.getFollowUpOrThrow(inserted.id) };
  }

  async findAll(query: ListFollowUpsQueryDto = {}) {
    const pagination = parsePagination(query);
    const parsedStatus = parseFollowUpStatus(query.status);
    const leadType = query.leadType ? parseLeadType(query.leadType) : undefined;
    const assigneeUserId = query.assigneeUserId?.trim() || undefined;
    const search = normalizeSearch(query.search);
    const sort = this.parseSort(query.sortBy, query.sortOrder);

    let followUpsQuery = this.db
      .selectFrom('crm.follow_ups')
      .leftJoin('crm.seller_leads', 'crm.seller_leads.id', 'crm.follow_ups.seller_lead_id')
      .leftJoin('crm.buyer_leads', 'crm.buyer_leads.id', 'crm.follow_ups.buyer_lead_id');

    if (parsedStatus === 'Overdue') {
      followUpsQuery = followUpsQuery
        .where('crm.follow_ups.completed_at', 'is', null)
        .where('crm.follow_ups.due_at', '<', new Date());
    } else if (parsedStatus === 'Due') {
      followUpsQuery = followUpsQuery
        .where('crm.follow_ups.status', '=', 'Due')
        .where('crm.follow_ups.completed_at', 'is', null)
        .where('crm.follow_ups.due_at', '>=', new Date());
    } else if (parsedStatus === 'Completed') {
      followUpsQuery = followUpsQuery.where('crm.follow_ups.status', '=', 'Completed');
    }

    if (leadType) {
      followUpsQuery = followUpsQuery.where('crm.follow_ups.lead_type', '=', leadType);
    }

    if (assigneeUserId) {
      followUpsQuery = followUpsQuery.where('crm.follow_ups.assignee_user_id', '=', assigneeUserId);
    }

    if (search) {
      const pattern = `%${search.toLowerCase()}%`;
      followUpsQuery = followUpsQuery.where(({ eb, or }) =>
        or([
          eb(sql<string>`lower(crm.follow_ups.note)`, 'like', pattern),
          eb(sql<string>`lower(coalesce(crm.follow_ups.outcome_note, ''))`, 'like', pattern),
          eb(sql<string>`lower(coalesce(crm.seller_leads.seller_name, ''))`, 'like', pattern),
          eb(sql<string>`lower(coalesce(crm.seller_leads.vehicle_brand, ''))`, 'like', pattern),
          eb(sql<string>`lower(coalesce(crm.seller_leads.vehicle_model, ''))`, 'like', pattern),
          eb(sql<string>`lower(coalesce(crm.buyer_leads.buyer_name, ''))`, 'like', pattern),
          eb(sql<string>`lower(coalesce(crm.buyer_leads.contact_number, ''))`, 'like', pattern),
        ]),
      );
    }

    const totalRow = await followUpsQuery
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const total = Number(totalRow.count);

    const followUps = await followUpsQuery
      .select('crm.follow_ups.id as id')
      .orderBy(sort.column, sort.direction)
      .orderBy('crm.follow_ups.created_at', 'asc')
      .offset(pagination.offset)
      .limit(pagination.pageSize)
      .execute();

    const hydrated = await Promise.all(followUps.map((followUp) => this.getFollowUpOrThrow(followUp.id)));
    const response = buildPaginatedResponse(hydrated, pagination, total);

    return {
      followUps: response.items,
      page: response.page,
      pageSize: response.pageSize,
      total: response.total,
      totalPages: response.totalPages,
    };
  }

  async findOne(id: string) {
    return { followUp: await this.getFollowUpOrThrow(id) };
  }

  async complete(id: string, dto: CompleteFollowUpDto) {
    const followUp = await this.getRecordOrThrow(id);
    const outcomeNote = dto.outcomeNote?.trim();

    if (!outcomeNote) {
      throw new BadRequestException('outcomeNote is required');
    }

    if (followUp.completed_at) {
      throw new BadRequestException('Follow-up is already completed');
    }

    await this.db
      .updateTable('crm.follow_ups')
      .set({
        status: 'Completed',
        completed_at: new Date(),
        outcome_note: outcomeNote,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    return { followUp: await this.getFollowUpOrThrow(id) };
  }

  private async getFollowUpOrThrow(id: string) {
    const followUp = await this.getRecordOrThrow(id);
    const computedStatus =
      !followUp.completed_at && followUp.due_at < new Date() ? 'Overdue' : followUp.status;

    return mapFollowUpResponse({
      ...followUp,
      lead_type: parseLeadType(followUp.lead_type),
      status: parseFollowUpStatus(computedStatus) ?? 'Due',
    });
  }

  private async getRecordOrThrow(id: string) {
    const followUp = await this.db
      .selectFrom('crm.follow_ups')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!followUp) {
      throw new NotFoundException(`Follow-up ${id} was not found`);
    }

    return followUp;
  }

  private async ensureBuyerLeadExists(id: string) {
    const buyerLead = await this.db
      .selectFrom('crm.buyer_leads')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!buyerLead) {
      throw new NotFoundException(`Buyer lead ${id} was not found`);
    }
  }

  private async ensureSellerLeadExists(id: string) {
    const sellerLead = await this.db
      .selectFrom('crm.seller_leads')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!sellerLead) {
      throw new NotFoundException(`Seller lead ${id} was not found`);
    }
  }

  private parseSort(sortBy?: string, sortOrder?: string) {
    const direction = this.parseSortOrder(sortOrder);

    switch (sortBy) {
      case undefined:
      case 'dueAt':
        return { column: 'crm.follow_ups.due_at' as const, direction };
      case 'createdAt':
        return { column: 'crm.follow_ups.created_at' as const, direction };
      case 'updatedAt':
        return { column: 'crm.follow_ups.updated_at' as const, direction };
      case 'status':
        return { column: 'crm.follow_ups.status' as const, direction };
      default:
        throw new BadRequestException(`Unsupported follow-up sort: ${sortBy}`);
    }
  }

  private parseSortOrder(sortOrder?: string): 'asc' | 'desc' {
    if (!sortOrder || sortOrder === 'asc') {
      return 'asc';
    }

    if (sortOrder === 'desc') {
      return 'desc';
    }

    throw new BadRequestException(`Unsupported sort order: ${sortOrder}`);
  }
}
