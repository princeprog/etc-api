import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Kysely, SelectQueryBuilder } from 'kysely';

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
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';
import {
  deriveFollowUpStatus,
  mapFollowUpResponse,
  parseDueDate,
  parseFollowUpStatus,
  parseLeadType,
  parseOptionalLeadType,
  parseSort,
} from './follow-ups.helpers';

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
        throw new BadRequestException(
          'buyer lead follow-up must include only buyerLeadId',
        );
      }

      await this.ensureBuyerLeadExists(dto.buyerLeadId);
    }

    if (leadType === 'seller') {
      if (!dto.sellerLeadId || dto.buyerLeadId) {
        throw new BadRequestException(
          'seller lead follow-up must include only sellerLeadId',
        );
      }

      await this.ensureSellerLeadExists(dto.sellerLeadId);
    }

    await this.ensureAssigneeExists(dto.assigneeUserId);

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
    const now = new Date();
    const pagination = parsePagination(query);
    const status = parseFollowUpStatus(query.status);
    const leadType = parseOptionalLeadType(query.leadType);
    const dueFrom = parseDueDate(query.dueFrom, 'dueFrom');
    const dueTo = parseDueDate(query.dueTo, 'dueTo');
    const search = normalizeSearch(query.search);
    const sort = parseSort(query.sort);

    const filtered = this.db
      .selectFrom('crm.follow_ups as fu')
      .leftJoin('crm.seller_leads as sl', 'sl.id', 'fu.seller_lead_id')
      .leftJoin('crm.buyer_leads as bl', 'bl.id', 'fu.buyer_lead_id')
      .$if(status === 'Completed', (qb) =>
        qb.where('fu.completed_at', 'is not', null),
      )
      .$if(status === 'Overdue', (qb) =>
        qb.where('fu.completed_at', 'is', null).where('fu.due_at', '<', now),
      )
      .$if(status === 'Due', (qb) =>
        qb.where('fu.completed_at', 'is', null).where('fu.due_at', '>=', now),
      )
      .$if(Boolean(leadType), (qb) => qb.where('fu.lead_type', '=', leadType!))
      .$if(Boolean(query.assigneeUserId), (qb) =>
        qb.where('fu.assignee_user_id', '=', query.assigneeUserId!),
      )
      .$if(Boolean(dueFrom), (qb) => qb.where('fu.due_at', '>=', dueFrom!))
      .$if(Boolean(dueTo), (qb) => qb.where('fu.due_at', '<=', dueTo!))
      .$if(Boolean(search), (qb) => {
        const pattern = `%${search}%`;
        return qb.where((eb) =>
          eb.or([
            eb('fu.note', 'ilike', pattern),
            eb('fu.outcome_note', 'ilike', pattern),
            eb('sl.seller_name', 'ilike', pattern),
            eb('bl.buyer_name', 'ilike', pattern),
          ]),
        );
      });

    const totalRow = await filtered
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    const total = Number(totalRow.count);

    const sortColumn = sort.endsWith('updatedAt')
      ? 'fu.updated_at'
      : 'fu.due_at';
    const sortDirection = sort.startsWith('-') ? 'desc' : 'asc';

    const rows = await filtered
      .select([
        'fu.id',
        'fu.lead_type',
        'fu.seller_lead_id',
        'fu.buyer_lead_id',
        'fu.assignee_user_id',
        'fu.due_at',
        'fu.completed_at',
        'fu.status',
        'fu.note',
        'fu.outcome_note',
        'fu.created_at',
        'fu.updated_at',
        'sl.seller_name',
        'sl.vehicle_brand',
        'sl.vehicle_model',
        'bl.buyer_name',
        'bl.contact_number',
      ])
      .orderBy(sortColumn, sortDirection)
      .orderBy('fu.id', 'asc')
      .limit(pagination.pageSize)
      .offset(pagination.offset)
      .execute();

    const followUps = rows.map((row) => {
      const rowLeadType = parseLeadType(row.lead_type);
      const leadName =
        rowLeadType === 'seller' ? row.seller_name : row.buyer_name;
      const leadSecondary =
        rowLeadType === 'seller'
          ? [row.vehicle_brand, row.vehicle_model].filter(Boolean).join(' ') ||
            null
          : row.contact_number;

      return mapFollowUpResponse({
        ...row,
        lead_type: rowLeadType,
        status: deriveFollowUpStatus(row.completed_at, row.due_at, now),
        lead_name: leadName,
        lead_secondary: leadSecondary,
      });
    });

    const response = buildPaginatedResponse(followUps, pagination, total);

    return {
      followUps: response.items,
      page: response.page,
      pageSize: response.pageSize,
      total: response.total,
      totalPages: response.totalPages,
    };
  }

  async summary(assigneeUserId?: string) {
    const now = new Date();
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
    const upcomingHorizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const scoped = () =>
      this.db
        .selectFrom('crm.follow_ups')
        .$if(Boolean(assigneeUserId), (qb) =>
          qb.where('assignee_user_id', '=', assigneeUserId!),
        );

    const [overdue, dueToday, upcoming, completed] = await Promise.all([
      this.countFollowUps(
        scoped().where('completed_at', 'is', null).where('due_at', '<', now),
      ),
      this.countFollowUps(
        scoped()
          .where('completed_at', 'is', null)
          .where('due_at', '>=', todayStart)
          .where('due_at', '<', tomorrowStart),
      ),
      this.countFollowUps(
        scoped()
          .where('completed_at', 'is', null)
          .where('due_at', '>', now)
          .where('due_at', '<=', upcomingHorizon),
      ),
      this.countFollowUps(scoped().where('completed_at', 'is not', null)),
    ]);

    return { summary: { overdue, dueToday, upcoming, completed } };
  }

  async findOne(id: string) {
    return { followUp: await this.getFollowUpOrThrow(id) };
  }

  async update(id: string, dto: UpdateFollowUpDto) {
    const followUp = await this.getRecordOrThrow(id);

    if (followUp.completed_at) {
      throw new BadRequestException('Completed follow-ups cannot be edited');
    }

    const updateValues: {
      due_at?: Date;
      note?: string;
      assignee_user_id?: string;
      updated_at: Date;
    } = { updated_at: new Date() };

    if (dto.dueAt !== undefined) {
      const dueAt = parseDueDate(dto.dueAt, 'dueAt');

      if (!dueAt) {
        throw new BadRequestException('dueAt cannot be empty');
      }

      updateValues.due_at = dueAt;
    }

    if (dto.note !== undefined) {
      const note = dto.note?.trim();

      if (!note) {
        throw new BadRequestException('note cannot be empty');
      }

      updateValues.note = note;
    }

    if (dto.assigneeUserId !== undefined) {
      if (!dto.assigneeUserId) {
        throw new BadRequestException('assigneeUserId cannot be empty');
      }

      await this.ensureAssigneeExists(dto.assigneeUserId);
      updateValues.assignee_user_id = dto.assigneeUserId;
    }

    await this.db
      .updateTable('crm.follow_ups')
      .set(updateValues)
      .where('id', '=', id)
      .execute();

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

  private async countFollowUps(
    query: SelectQueryBuilder<DB, 'crm.follow_ups', object>,
  ): Promise<number> {
    const result = await query
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();

    return Number(result.count);
  }

  private async getFollowUpOrThrow(id: string) {
    const followUp = await this.getRecordOrThrow(id);
    const now = new Date();

    return mapFollowUpResponse({
      ...followUp,
      lead_type: parseLeadType(followUp.lead_type),
      status: deriveFollowUpStatus(followUp.completed_at, followUp.due_at, now),
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

  private async ensureAssigneeExists(id: string) {
    const user = await this.db
      .selectFrom('auth.users')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!user) {
      throw new NotFoundException(`Assignee ${id} was not found`);
    }
  }
}
