import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Kysely, type SelectQueryBuilder } from 'kysely';

import {
  buildPaginatedResponse,
  normalizeSearch,
  parsePagination,
} from '../../common/utils/list-query.utils';
import type { CurrentUser } from '../../common/types/auth.types';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { ActivityHistoryService } from '../activity-history/activity-history.service';
import { NotificationsService } from '../notifications/notifications.service';
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

const UNIQUE_VIOLATION_CODE = '23505';

@Injectable()
export class FollowUpsService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly activityHistoryService: ActivityHistoryService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(user: CurrentUser, dto: CreateFollowUpDto) {
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
    const existingActive = await this.getActiveRecordForLead(
      leadType,
      leadType === 'buyer' ? dto.buyerLeadId! : dto.sellerLeadId!,
    );

    if (existingActive) {
      throw new ConflictException(
        'An active follow-up already exists for this lead. Reschedule it instead.',
      );
    }

    let inserted: { id: string };
    try {
      inserted = await this.db
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
    } catch (error) {
      if (this.isDatabaseError(error) && error.code === UNIQUE_VIOLATION_CODE) {
        throw new ConflictException(
          'An active follow-up already exists for this lead. Reschedule it instead.',
        );
      }

      throw error;
    }

    await this.activityHistoryService.write({
      actor: user,
      entityType: 'follow_up',
      entityId: inserted.id,
      actionType: 'follow_up.created',
      summary: 'Follow-up scheduled',
      metadata: {
        leadType,
        sellerLeadId: dto.sellerLeadId ?? null,
        buyerLeadId: dto.buyerLeadId ?? null,
        assigneeUserId: dto.assigneeUserId,
        dueAt: dto.dueAt,
      },
    });

    const followUp = await this.getRecordOrThrow(inserted.id);
    await this.writeLeadFollowUpActivity(user, followUp, 'scheduled');
    await this.notificationsService.refreshForFollowUp(inserted.id);

    return { followUp: await this.getFollowUpOrThrow(inserted.id) };
  }

  async findAll(query: ListFollowUpsQueryDto = {}) {
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
      .innerJoin(
        'authentication.users as assignee',
        'assignee.id',
        'fu.assignee_user_id',
      )
      .innerJoin(
        'authentication.roles as assignee_role',
        'assignee_role.id',
        'assignee.role_id',
      )
      .$if(status === 'Completed', (qb) =>
        qb
          .where('fu.completed_at', 'is not', null)
          .where('fu.cancelled_at', 'is', null),
      )
      .$if(status === 'Cancelled', (qb) =>
        qb.where('fu.cancelled_at', 'is not', null),
      )
      .$if(status === 'Overdue', (qb) =>
        qb
          .where('fu.completed_at', 'is', null)
          .where('fu.cancelled_at', 'is', null)
          .where('fu.due_at', '<', now),
      )
      .$if(status === 'Due', (qb) =>
        qb
          .where('fu.completed_at', 'is', null)
          .where('fu.cancelled_at', 'is', null)
          .where('fu.due_at', '>=', now),
      )
      .$if(status === 'DueToday', (qb) =>
        qb
          .where('fu.completed_at', 'is', null)
          .where('fu.cancelled_at', 'is', null)
          .where('fu.due_at', '>=', todayStart)
          .where('fu.due_at', '<', tomorrowStart),
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

    const baseSort = sort.replace(/^-/, '');
    const sortDirection = sort.startsWith('-') ? 'desc' : 'asc';

    const sortExpression = (() => {
      switch (baseSort) {
        case 'note':
          return sql`fu.note`;
        case 'leadType':
          return sql`fu.lead_type`;
        case 'leadName':
          return sql`COALESCE(sl.seller_name, bl.buyer_name)`;
        case 'status':
          return sql`CASE WHEN fu.cancelled_at IS NOT NULL THEN 3 WHEN fu.completed_at IS NOT NULL THEN 2 WHEN fu.due_at < ${now} THEN 0 ELSE 1 END`;
        case 'updatedAt':
          return sql`fu.updated_at`;
        case 'dueAt':
        default:
          return sql`fu.due_at`;
      }
    })();

    const rows = await filtered
      .select([
        'fu.id',
        'fu.lead_type',
        'fu.seller_lead_id',
        'fu.buyer_lead_id',
        'fu.assignee_user_id',
        'fu.due_at',
        'fu.completed_at',
        'fu.cancelled_at',
        'fu.cancellation_reason',
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
        'assignee.id as assignee_id',
        'assignee.full_name as assignee_full_name',
        'assignee.email as assignee_email',
        'assignee_role.name as assignee_role_name',
      ])
      .orderBy(sortExpression, sortDirection)
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
        status: deriveFollowUpStatus(
          row.completed_at,
          row.cancelled_at,
          row.due_at,
          now,
        ),
        lead_name: leadName,
        lead_secondary: leadSecondary,
        assignee: {
          id: row.assignee_id,
          fullName: row.assignee_full_name,
          email: row.assignee_email,
          roleName: row.assignee_role_name,
        },
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
        scoped()
          .where('completed_at', 'is', null)
          .where('cancelled_at', 'is', null)
          .where('due_at', '<', now),
      ),
      this.countFollowUps(
        scoped()
          .where('completed_at', 'is', null)
          .where('cancelled_at', 'is', null)
          .where('due_at', '>=', todayStart)
          .where('due_at', '<', tomorrowStart),
      ),
      this.countFollowUps(
        scoped()
          .where('completed_at', 'is', null)
          .where('cancelled_at', 'is', null)
          .where('due_at', '>', now)
          .where('due_at', '<=', upcomingHorizon),
      ),
      this.countFollowUps(
        scoped()
          .where('completed_at', 'is not', null)
          .where('cancelled_at', 'is', null),
      ),
    ]);

    return { summary: { overdue, dueToday, upcoming, completed } };
  }

  async findOne(id: string) {
    return { followUp: await this.getFollowUpOrThrow(id) };
  }

  async findActive(
    leadTypeValue: string | undefined,
    leadId: string | undefined,
  ) {
    const leadType = parseLeadType(leadTypeValue ?? '');

    if (!leadId?.trim()) {
      throw new BadRequestException('leadId is required');
    }

    const followUp = await this.getActiveRecordForLead(leadType, leadId);

    if (!followUp) {
      return { followUp: null };
    }

    return { followUp: await this.mapRecordToResponse(followUp) };
  }

  async update(user: CurrentUser, id: string, dto: UpdateFollowUpDto) {
    const followUp = await this.getRecordOrThrow(id);

    if (followUp.completed_at) {
      throw new BadRequestException('Completed follow-ups cannot be edited');
    }

    if (followUp.cancelled_at) {
      throw new BadRequestException('Cancelled follow-ups cannot be edited');
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

    await this.activityHistoryService.write({
      actor: user,
      entityType: 'follow_up',
      entityId: id,
      actionType: 'follow_up.updated',
      summary: 'Follow-up updated',
      metadata: {
        leadType: followUp.lead_type,
        sellerLeadId: followUp.seller_lead_id,
        buyerLeadId: followUp.buyer_lead_id,
        previousDueAt: followUp.due_at.toISOString(),
        nextDueAt:
          updateValues.due_at?.toISOString() ?? followUp.due_at.toISOString(),
        assigneeUserId:
          updateValues.assignee_user_id ?? followUp.assignee_user_id,
        changedFields: [
          updateValues.due_at ? 'dueAt' : null,
          updateValues.note ? 'note' : null,
          updateValues.assignee_user_id ? 'assigneeUserId' : null,
        ].filter(Boolean),
      },
    });

    const updatedFollowUp = await this.getRecordOrThrow(id);
    await this.writeLeadFollowUpActivity(
      user,
      updatedFollowUp,
      updateValues.due_at ? 'rescheduled' : 'updated',
    );
    await this.notificationsService.refreshForFollowUp(id);

    return { followUp: await this.mapRecordToResponse(updatedFollowUp) };
  }
  async complete(user: CurrentUser, id: string, dto: CompleteFollowUpDto) {
    const followUp = await this.getRecordOrThrow(id);
    const outcomeNote = dto.outcomeNote?.trim();

    if (!outcomeNote) {
      throw new BadRequestException('outcomeNote is required');
    }

    if (followUp.completed_at) {
      throw new BadRequestException('Follow-up is already completed');
    }

    if (followUp.cancelled_at) {
      throw new BadRequestException('Cancelled follow-ups cannot be completed');
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

    await this.activityHistoryService.write({
      actor: user,
      entityType: 'follow_up',
      entityId: id,
      actionType: 'follow_up.completed',
      summary: 'Follow-up completed',
      metadata: {
        leadType: followUp.lead_type,
        sellerLeadId: followUp.seller_lead_id,
        buyerLeadId: followUp.buyer_lead_id,
        dueAt: followUp.due_at.toISOString(),
      },
    });

    await this.writeLeadFollowUpActivity(user, followUp, 'completed');
    await this.notificationsService.resolveForFollowUp(id);

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
  private async writeLeadFollowUpActivity(
    user: CurrentUser,
    followUp: Awaited<ReturnType<FollowUpsService['getRecordOrThrow']>>,
    action: 'scheduled' | 'updated' | 'rescheduled' | 'completed',
  ) {
    const entityType =
      followUp.lead_type === 'buyer' ? 'buyer_lead' : 'seller_lead';
    const entityId =
      followUp.lead_type === 'buyer'
        ? followUp.buyer_lead_id
        : followUp.seller_lead_id;

    if (!entityId) {
      return;
    }

    await this.activityHistoryService.write({
      actor: user,
      entityType,
      entityId,
      actionType: `${entityType}.follow_up_${action}`,
      summary: this.getLeadFollowUpActivitySummary(action),
      metadata: {
        followUpId: followUp.id,
        dueAt: followUp.due_at.toISOString(),
        assigneeUserId: followUp.assignee_user_id,
      },
    });
  }

  private async getFollowUpOrThrow(id: string) {
    const followUp = await this.getRecordOrThrow(id);

    return this.mapRecordToResponse(followUp);
  }

  private async mapRecordToResponse(
    followUp: Awaited<ReturnType<FollowUpsService['getRecordOrThrow']>>,
  ) {
    const now = new Date();
    return mapFollowUpResponse({
      ...followUp,
      lead_type: parseLeadType(followUp.lead_type),
      status: deriveFollowUpStatus(
        followUp.completed_at,
        followUp.cancelled_at,
        followUp.due_at,
        now,
      ),
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

  private async getActiveRecordForLead(
    leadType: 'buyer' | 'seller',
    leadId: string,
  ) {
    return this.db
      .selectFrom('crm.follow_ups')
      .selectAll()
      .where(
        leadType === 'buyer' ? 'buyer_lead_id' : 'seller_lead_id',
        '=',
        leadId,
      )
      .where('completed_at', 'is', null)
      .where('cancelled_at', 'is', null)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  private getLeadFollowUpActivitySummary(
    action: 'scheduled' | 'updated' | 'rescheduled' | 'completed',
  ) {
    switch (action) {
      case 'scheduled':
        return 'Follow-up scheduled for lead';
      case 'updated':
        return 'Lead follow-up updated';
      case 'rescheduled':
        return 'Lead follow-up rescheduled';
      case 'completed':
        return 'Lead follow-up completed';
    }
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
      .selectFrom('authentication.users')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!user) {
      throw new NotFoundException(`Assignee ${id} was not found`);
    }
  }

  private isDatabaseError(error: unknown): error is { code?: string } {
    return typeof error === 'object' && error !== null && 'code' in error;
  }
}
