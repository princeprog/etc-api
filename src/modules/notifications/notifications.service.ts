import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql, type Kysely } from 'kysely';

import type { CurrentUser } from '../../common/types/auth.types';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import type {
  ExpenseNotificationType,
  FollowUpNotificationType,
  LeadType,
  NotificationType,
  VehicleNotificationType,
} from '../../database/schema';
import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  formatDateKey,
  getAppTimeZone,
  getTodayDateKey,
  parseBoolean,
  parsePositiveInteger,
  resolveExpenseDisplayStatus,
} from '../expenses/expenses.helpers';
import type { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { resolveFollowUpNotificationType } from './notifications.helpers';
import type { NotificationResponse } from './notifications.types';

const UNIQUE_VIOLATION_CODE = '23505';
const NOTIFICATION_CATEGORIES = [
  'all',
  'follow-ups',
  'sales',
  'bills',
  'system',
] as const;
const NOTIFICATION_STATUSES = ['all', 'read', 'unread'] as const;
const NOTIFICATION_DATE_RANGES = ['all', '7', '30', '90'] as const;

type NotificationCategoryFilter = (typeof NOTIFICATION_CATEGORIES)[number];
type NotificationStatusFilter = (typeof NOTIFICATION_STATUSES)[number];
type NotificationDateRangeFilter = (typeof NOTIFICATION_DATE_RANGES)[number];

type NormalizedNotificationFilters = {
  search: string | null;
  category: NotificationCategoryFilter;
  status: NotificationStatusFilter;
  dateRange: NotificationDateRangeFilter;
  includeResolved: boolean;
};

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  entity_type: string;
  entity_id: string;
  due_date_snapshot: Date | null;
  read_at: Date | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type ExpenseNotificationSource = {
  id: string;
  title: string;
  expected_amount: string;
  due_date: Date;
  status: string;
  assigned_staff_id: string | null;
};

type FollowUpNotificationSource = {
  id: string;
  lead_type: LeadType;
  assignee_user_id: string;
  due_at: Date;
  completed_at: Date | null;
  cancelled_at: Date | null;
  note: string;
  seller_name: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  buyer_name: string | null;
  contact_number: string | null;
};

type VehicleNotificationSource = {
  id: string;
  stock_number: string;
  brand: string;
  model: string;
  year: number;
  variant: string | null;
  updated_at: Date;
};

@Injectable()
export class NotificationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async onApplicationBootstrap() {
    await Promise.all([
      this.generateExpenseNotifications(),
      this.generateFollowUpNotifications(),
    ]).catch((error: unknown) => {
      this.logger.error('Failed to generate notifications on bootstrap', error);
    });
  }

  @Cron('20 0 * * *', { timeZone: getAppTimeZone() })
  async runDailyExpenseNotificationGeneration() {
    await Promise.all([
      this.generateExpenseNotifications(),
      this.generateFollowUpNotifications(),
    ]);
  }

  async list(user: CurrentUser, query: ListNotificationsQueryDto) {
    const page = parsePositiveInteger(query.page, 1, 'page', {
      min: 1,
      max: 1000,
    });
    const pageSize = parsePositiveInteger(query.pageSize, 20, 'pageSize', {
      min: 1,
      max: 100,
    });
    const offset = (page - 1) * pageSize;
    const unreadOnly = parseBoolean(query.unreadOnly);
    const filters = this.normalizeListFilters(query, unreadOnly);

    const filtered = this.applyNotificationFilters(
      this.db
        .selectFrom('ops.notifications')
        .select([
          'id',
          'type',
          'title',
          'message',
          'entity_type',
          'entity_id',
          'due_date_snapshot',
          'read_at',
          'resolved_at',
          'created_at',
          'updated_at',
        ])
        .where('recipient_user_id', '=', user.id),
      filters,
    );
    const countQuery = this.applyNotificationFilters(
      this.db
        .selectFrom('ops.notifications')
        .select(({ fn }) => fn.count<string>('id').as('total'))
        .where('recipient_user_id', '=', user.id),
      filters,
    );

    const [rows, totalRow] = await Promise.all([
      filtered
        .orderBy('created_at', 'desc')
        .offset(offset)
        .limit(pageSize)
        .execute(),
      countQuery.executeTakeFirstOrThrow(),
    ]);
    const total = Number(totalRow.total);

    return {
      notifications: rows.map(mapNotification),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async getUnreadCount(user: CurrentUser) {
    const row = await this.db
      .selectFrom('ops.notifications')
      .select(({ fn }) => fn.count<string>('id').as('count'))
      .where('recipient_user_id', '=', user.id)
      .where('read_at', 'is', null)
      .where('resolved_at', 'is', null)
      .executeTakeFirstOrThrow();

    return { count: Number(row.count) };
  }

  async markRead(user: CurrentUser, id: string) {
    return this.setReadState(user, id, true);
  }

  async markUnread(user: CurrentUser, id: string) {
    return this.setReadState(user, id, false);
  }

  async markAllRead(user: CurrentUser) {
    await this.db
      .updateTable('ops.notifications')
      .set({
        read_at: new Date(),
        updated_at: new Date(),
      })
      .where('recipient_user_id', '=', user.id)
      .where('read_at', 'is', null)
      .where('resolved_at', 'is', null)
      .execute();

    return this.getUnreadCount(user);
  }

  async resolveForExpense(expenseId: string) {
    await this.db
      .updateTable('ops.notifications')
      .set({
        resolved_at: new Date(),
        updated_at: new Date(),
      })
      .where('entity_type', '=', 'expense')
      .where('entity_id', '=', expenseId)
      .where('resolved_at', 'is', null)
      .execute();
  }

  async refreshForExpense(expenseId: string) {
    await this.resolveForExpense(expenseId);
    return this.generateExpenseNotificationsForExpense(expenseId);
  }

  async resolveForFollowUp(followUpId: string) {
    await this.db
      .updateTable('ops.notifications')
      .set({
        resolved_at: new Date(),
        updated_at: new Date(),
      })
      .where('entity_type', '=', 'follow_up')
      .where('entity_id', '=', followUpId)
      .where('resolved_at', 'is', null)
      .execute();
  }

  async refreshForFollowUp(followUpId: string) {
    await this.resolveForFollowUp(followUpId);
    return this.generateFollowUpNotificationsForFollowUp(followUpId);
  }

  async notifyVehicleAvailable(vehicleId: string) {
    const vehicle = await this.db
      .selectFrom('inventory.vehicles')
      .select([
        'id',
        'stock_number',
        'brand',
        'model',
        'year',
        'variant',
        'updated_at',
      ])
      .where('id', '=', vehicleId)
      .executeTakeFirst();

    if (!vehicle) {
      return { created: 0 };
    }

    const recipients = await this.resolveAllActiveRecipients();
    let created = 0;

    for (const recipientId of recipients) {
      const didCreate = await this.upsertVehicleNotification(
        recipientId,
        vehicle,
        'vehicle_available',
      );
      if (didCreate) {
        created += 1;
      }
    }

    return { created };
  }

  async generateExpenseNotifications() {
    const todayKey = getTodayDateKey();
    const lookaheadKey = addDaysToDateKey(todayKey, 7);
    const expenses = await this.db
      .selectFrom('finance.expenses')
      .select([
        'id',
        'title',
        'expected_amount',
        'due_date',
        'status',
        'assigned_staff_id',
      ])
      .where('status', '=', 'unpaid')
      .where('due_date', '<=', sql<Date>`${lookaheadKey}::date`)
      .execute();

    let created = 0;
    for (const expense of expenses) {
      created += await this.generateForExpense(expense, todayKey);
    }

    return { created };
  }

  async generateExpenseNotificationsForExpense(expenseId: string) {
    const expense = await this.db
      .selectFrom('finance.expenses')
      .select([
        'id',
        'title',
        'expected_amount',
        'due_date',
        'status',
        'assigned_staff_id',
      ])
      .where('id', '=', expenseId)
      .executeTakeFirst();

    if (!expense || expense.status !== 'unpaid') {
      return { created: 0 };
    }

    return {
      created: await this.generateForExpense(expense, getTodayDateKey()),
    };
  }

  async generateFollowUpNotifications() {
    const now = new Date();
    const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const followUps = await this.buildFollowUpNotificationSourceQuery()
      .where('fu.completed_at', 'is', null)
      .where('fu.cancelled_at', 'is', null)
      .where('fu.due_at', '<=', horizon)
      .execute();

    let created = 0;
    for (const followUp of followUps) {
      created += await this.generateForFollowUp(
        this.normalizeFollowUpNotificationSource(followUp),
        now,
        getTodayDateKey(),
      );
    }

    return { created };
  }

  async generateFollowUpNotificationsForFollowUp(followUpId: string) {
    const followUp = await this.buildFollowUpNotificationSourceQuery()
      .where('fu.id', '=', followUpId)
      .executeTakeFirst();

    if (!followUp || followUp.completed_at || followUp.cancelled_at) {
      return { created: 0 };
    }

    return {
      created: await this.generateForFollowUp(
        this.normalizeFollowUpNotificationSource(followUp),
        new Date(),
        getTodayDateKey(),
      ),
    };
  }

  private async setReadState(user: CurrentUser, id: string, isRead: boolean) {
    const updated = await this.db
      .updateTable('ops.notifications')
      .set({
        read_at: isRead ? new Date() : null,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('recipient_user_id', '=', user.id)
      .returning([
        'id',
        'type',
        'title',
        'message',
        'entity_type',
        'entity_id',
        'due_date_snapshot',
        'read_at',
        'resolved_at',
        'created_at',
        'updated_at',
      ])
      .executeTakeFirst();

    if (!updated) {
      throw new NotFoundException('Notification was not found');
    }

    return { notification: mapNotification(updated) };
  }

  private async generateForExpense(
    expense: ExpenseNotificationSource,
    todayKey: string,
  ) {
    const trigger = this.resolveExpenseTrigger(expense, todayKey);

    if (!trigger) {
      return 0;
    }

    const recipients = await this.resolveRecipients(expense.assigned_staff_id);
    let created = 0;

    for (const recipientId of recipients) {
      const didCreate = await this.upsertNotification(
        recipientId,
        expense,
        trigger,
      );
      if (didCreate) {
        created += 1;
      }
    }

    return created;
  }

  private async generateForFollowUp(
    followUp: FollowUpNotificationSource,
    now: Date,
    todayKey: string,
  ) {
    const trigger = this.resolveFollowUpTrigger(followUp, now, todayKey);

    if (!trigger) {
      return 0;
    }

    const recipients = await this.resolveRecipients(followUp.assignee_user_id);
    let created = 0;

    for (const recipientId of recipients) {
      const didCreate = await this.upsertFollowUpNotification(
        recipientId,
        followUp,
        trigger,
      );
      if (didCreate) {
        created += 1;
      }
    }

    return created;
  }

  private resolveExpenseTrigger(
    expense: ExpenseNotificationSource,
    todayKey: string,
  ): ExpenseNotificationType | null {
    const dueKey = formatDateKey(expense.due_date);
    const daysUntilDue = daysBetweenDateKeys(todayKey, dueKey);

    if (daysUntilDue < 0) {
      return 'expense_overdue';
    }

    if (daysUntilDue === 0) {
      return 'expense_due_today';
    }

    if (daysUntilDue <= 7) {
      return 'expense_due_soon';
    }

    return null;
  }

  private resolveFollowUpTrigger(
    followUp: FollowUpNotificationSource,
    now: Date,
    todayKey: string,
  ): FollowUpNotificationType | null {
    return resolveFollowUpNotificationType(followUp.due_at, now, todayKey);
  }

  private async resolveRecipients(assignedStaffId: string | null) {
    const users = await this.db
      .selectFrom('authentication.users')
      .select(['id'])
      .where('active', '=', true)
      .where((eb) =>
        eb.or([
          eb('role', '=', 'admin'),
          assignedStaffId
            ? eb('id', '=', assignedStaffId)
            : eb(sql`false`, '=', sql`true`),
        ]),
      )
      .execute();

    return Array.from(new Set(users.map((user) => user.id)));
  }

  private async resolveAllActiveRecipients() {
    const users = await this.db
      .selectFrom('authentication.users')
      .select(['id'])
      .where('active', '=', true)
      .execute();

    return users.map((user) => user.id);
  }

  private async upsertNotification(
    recipientId: string,
    expense: ExpenseNotificationSource,
    type: ExpenseNotificationType,
  ) {
    const dueDateKey = formatDateKey(expense.due_date);
    const deduplicationKey = `${type}:expense:${expense.id}:${dueDateKey}:${recipientId}`;
    const content = this.buildExpenseNotificationContent(expense, type);
    const existing = await this.db
      .selectFrom('ops.notifications')
      .select(['id', 'resolved_at'])
      .where('deduplication_key', '=', deduplicationKey)
      .executeTakeFirst();

    if (existing) {
      if (!existing.resolved_at) {
        await this.db
          .updateTable('ops.notifications')
          .set({
            title: content.title,
            message: content.message,
            updated_at: new Date(),
          })
          .where('id', '=', existing.id)
          .execute();
      }

      return false;
    }

    try {
      await this.db
        .insertInto('ops.notifications')
        .values({
          recipient_user_id: recipientId,
          type,
          title: content.title,
          message: content.message,
          entity_type: 'expense',
          entity_id: expense.id,
          due_date_snapshot: expense.due_date,
          deduplication_key: deduplicationKey,
        })
        .execute();

      return true;
    } catch (error) {
      if (this.isDatabaseError(error) && error.code === UNIQUE_VIOLATION_CODE) {
        return false;
      }

      throw error;
    }
  }

  private async upsertFollowUpNotification(
    recipientId: string,
    followUp: FollowUpNotificationSource,
    type: FollowUpNotificationType,
  ) {
    const dueDateKey = formatDateKey(followUp.due_at);
    const deduplicationKey = `${type}:follow_up:${followUp.id}:${dueDateKey}:${recipientId}`;
    const content = this.buildFollowUpNotificationContent(followUp, type);
    const existing = await this.db
      .selectFrom('ops.notifications')
      .select(['id', 'resolved_at'])
      .where('deduplication_key', '=', deduplicationKey)
      .executeTakeFirst();

    if (existing) {
      if (!existing.resolved_at) {
        await this.db
          .updateTable('ops.notifications')
          .set({
            title: content.title,
            message: content.message,
            updated_at: new Date(),
          })
          .where('id', '=', existing.id)
          .execute();
      }

      return false;
    }

    try {
      await this.db
        .insertInto('ops.notifications')
        .values({
          recipient_user_id: recipientId,
          type,
          title: content.title,
          message: content.message,
          entity_type: 'follow_up',
          entity_id: followUp.id,
          due_date_snapshot: followUp.due_at,
          deduplication_key: deduplicationKey,
        })
        .execute();

      return true;
    } catch (error) {
      if (this.isDatabaseError(error) && error.code === UNIQUE_VIOLATION_CODE) {
        return false;
      }

      throw error;
    }
  }

  private async upsertVehicleNotification(
    recipientId: string,
    vehicle: VehicleNotificationSource,
    type: VehicleNotificationType,
  ) {
    const statusChangedAt = vehicle.updated_at.toISOString();
    const deduplicationKey = `${type}:vehicle:${vehicle.id}:${statusChangedAt}:${recipientId}`;
    const content = this.buildVehicleNotificationContent(vehicle, type);
    const existing = await this.db
      .selectFrom('ops.notifications')
      .select(['id', 'resolved_at'])
      .where('deduplication_key', '=', deduplicationKey)
      .executeTakeFirst();

    if (existing) {
      if (!existing.resolved_at) {
        await this.db
          .updateTable('ops.notifications')
          .set({
            title: content.title,
            message: content.message,
            updated_at: new Date(),
          })
          .where('id', '=', existing.id)
          .execute();
      }

      return false;
    }

    try {
      await this.db
        .insertInto('ops.notifications')
        .values({
          recipient_user_id: recipientId,
          type,
          title: content.title,
          message: content.message,
          entity_type: 'vehicle',
          entity_id: vehicle.id,
          deduplication_key: deduplicationKey,
        })
        .execute();

      return true;
    } catch (error) {
      if (this.isDatabaseError(error) && error.code === UNIQUE_VIOLATION_CODE) {
        return false;
      }

      throw error;
    }
  }

  private buildExpenseNotificationContent(
    expense: ExpenseNotificationSource,
    type: ExpenseNotificationType,
  ) {
    const amount = `PHP ${Number(expense.expected_amount).toLocaleString(
      'en-PH',
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
    )}`;
    const dueDate = formatDateKey(expense.due_date);
    const displayStatus = resolveExpenseDisplayStatus(expense);

    switch (type) {
      case 'expense_due_soon':
        return {
          title: 'Bill due soon',
          message: `${expense.title} of ${amount} is due on ${dueDate}.`,
        };
      case 'expense_due_today':
        return {
          title: 'Bill due today',
          message: `${expense.title} of ${amount} is due today.`,
        };
      case 'expense_overdue':
        return {
          title: 'Overdue bill',
          message: `${expense.title} of ${amount} is ${displayStatus.replace('_', ' ')} since ${dueDate}.`,
        };
    }
  }

  private buildFollowUpNotificationContent(
    followUp: FollowUpNotificationSource,
    type: FollowUpNotificationType,
  ) {
    const leadLabel = this.getFollowUpLeadLabel(followUp);
    const note = truncateText(followUp.note, 90);
    const dueDate = formatDateKey(followUp.due_at);
    const dueTime = followUp.due_at.toLocaleTimeString('en-PH', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: getAppTimeZone(),
    });

    switch (type) {
      case 'follow_up_due_soon':
        return {
          title: 'Follow-up due soon',
          message: `${leadLabel} has a follow-up due on ${dueDate} at ${dueTime}: ${note}.`,
        };
      case 'follow_up_due_today':
        return {
          title: 'Follow-up due today',
          message: `${leadLabel} has a follow-up due today at ${dueTime}: ${note}.`,
        };
      case 'follow_up_overdue':
        return {
          title: 'Overdue follow-up',
          message: `${leadLabel} had a follow-up due on ${dueDate} at ${dueTime}: ${note}.`,
        };
    }
  }

  private buildVehicleNotificationContent(
    vehicle: VehicleNotificationSource,
    type: VehicleNotificationType,
  ) {
    const vehicleLabel = [
      vehicle.year,
      vehicle.brand,
      vehicle.model,
      vehicle.variant,
    ]
      .filter(Boolean)
      .join(' ');

    switch (type) {
      case 'vehicle_available':
        return {
          title: 'Vehicle now available',
          message: `${vehicle.stock_number} - ${vehicleLabel} is now available for buyer matching and sales activity.`,
        };
    }
  }

  private getFollowUpLeadLabel(followUp: FollowUpNotificationSource) {
    if (followUp.lead_type === 'seller') {
      const vehicle = [followUp.vehicle_brand, followUp.vehicle_model]
        .filter(Boolean)
        .join(' ');
      return (
        [followUp.seller_name, vehicle].filter(Boolean).join(' - ') ||
        'Seller lead'
      );
    }

    return (
      [followUp.buyer_name, followUp.contact_number]
        .filter(Boolean)
        .join(' - ') || 'Buyer lead'
    );
  }

  private buildFollowUpNotificationSourceQuery() {
    return this.db
      .selectFrom('crm.follow_ups as fu')
      .leftJoin('crm.seller_leads as sl', 'sl.id', 'fu.seller_lead_id')
      .leftJoin('crm.buyer_leads as bl', 'bl.id', 'fu.buyer_lead_id')
      .select([
        'fu.id',
        'fu.lead_type',
        'fu.assignee_user_id',
        'fu.due_at',
        'fu.completed_at',
        'fu.cancelled_at',
        'fu.note',
        'sl.seller_name',
        'sl.vehicle_brand',
        'sl.vehicle_model',
        'bl.buyer_name',
        'bl.contact_number',
      ]);
  }

  private normalizeFollowUpNotificationSource(
    followUp: Omit<FollowUpNotificationSource, 'lead_type'> & {
      lead_type: string;
    },
  ): FollowUpNotificationSource {
    return {
      ...followUp,
      lead_type: followUp.lead_type === 'buyer' ? 'buyer' : 'seller',
    };
  }

  private normalizeListFilters(
    query: ListNotificationsQueryDto,
    unreadOnly: boolean,
  ): NormalizedNotificationFilters {
    const search = query.search?.trim() || null;
    const category = this.parseNotificationCategory(query.category);
    const status = unreadOnly
      ? 'unread'
      : this.parseNotificationStatus(query.status);
    const dateRange = this.parseNotificationDateRange(query.dateRange);
    const includeResolved = parseBoolean(query.includeResolved);

    return {
      search,
      category,
      status,
      dateRange,
      includeResolved,
    };
  }

  private parseNotificationCategory(
    value: string | undefined,
  ): NotificationCategoryFilter {
    const normalized = value?.trim() || 'all';

    if (
      NOTIFICATION_CATEGORIES.includes(normalized as NotificationCategoryFilter)
    ) {
      return normalized as NotificationCategoryFilter;
    }

    throw new BadRequestException(
      `category must be one of: ${NOTIFICATION_CATEGORIES.join(', ')}`,
    );
  }

  private parseNotificationStatus(
    value: string | undefined,
  ): NotificationStatusFilter {
    const normalized = value?.trim() || 'all';

    if (
      NOTIFICATION_STATUSES.includes(normalized as NotificationStatusFilter)
    ) {
      return normalized as NotificationStatusFilter;
    }

    throw new BadRequestException(
      `status must be one of: ${NOTIFICATION_STATUSES.join(', ')}`,
    );
  }

  private parseNotificationDateRange(
    value: string | undefined,
  ): NotificationDateRangeFilter {
    const normalized = value?.trim() || 'all';

    if (
      NOTIFICATION_DATE_RANGES.includes(
        normalized as NotificationDateRangeFilter,
      )
    ) {
      return normalized as NotificationDateRangeFilter;
    }

    throw new BadRequestException(
      `dateRange must be one of: ${NOTIFICATION_DATE_RANGES.join(', ')}`,
    );
  }

  private applyNotificationFilters<
    TQuery extends { where: (...args: any[]) => TQuery },
  >(query: TQuery, filters: NormalizedNotificationFilters) {
    let nextQuery = query;

    if (filters.search) {
      const pattern = `%${filters.search}%`;
      nextQuery = nextQuery.where((eb: any) =>
        eb.or([
          eb('title', 'ilike', pattern),
          eb('message', 'ilike', pattern),
          eb('entity_type', 'ilike', pattern),
        ]),
      );
    }

    if (filters.category === 'follow-ups') {
      nextQuery = nextQuery.where('entity_type', '=', 'follow_up');
    } else if (filters.category === 'sales') {
      nextQuery = nextQuery.where('entity_type', '=', 'sale');
    } else if (filters.category === 'bills') {
      nextQuery = nextQuery.where('entity_type', '=', 'expense');
    } else if (filters.category === 'system') {
      nextQuery = nextQuery.where('entity_type', 'not in', [
        'expense',
        'follow_up',
        'sale',
      ]);
    }

    if (filters.status === 'unread') {
      nextQuery = nextQuery.where('read_at', 'is', null);
    } else if (filters.status === 'read') {
      nextQuery = nextQuery.where('read_at', 'is not', null);
    }

    if (filters.dateRange !== 'all') {
      const days = Number(filters.dateRange);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0);
      nextQuery = nextQuery.where('created_at', '>=', startDate);
    }

    if (!filters.includeResolved) {
      nextQuery = nextQuery.where('resolved_at', 'is', null);
    }

    return nextQuery;
  }

  private isDatabaseError(error: unknown): error is { code?: string } {
    return typeof error === 'object' && error !== null && 'code' in error;
  }
}

function mapNotification(row: NotificationRow): NotificationResponse {
  return {
    id: row.id,
    type: parseNotificationType(row.type),
    title: row.title,
    message: row.message,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actionUrl:
      row.entity_type === 'expense'
        ? `/bills-expenses/${row.entity_id}`
        : row.entity_type === 'follow_up'
          ? '/follow-ups'
          : row.entity_type === 'vehicle'
            ? `/vehicles/${row.entity_id}`
            : null,
    dueDateSnapshot: row.due_date_snapshot,
    isRead: row.read_at !== null,
    readAt: row.read_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseNotificationType(value: string): NotificationType {
  if (
    value === 'expense_due_soon' ||
    value === 'expense_due_today' ||
    value === 'expense_overdue' ||
    value === 'follow_up_due_soon' ||
    value === 'follow_up_due_today' ||
    value === 'follow_up_overdue' ||
    value === 'vehicle_available'
  ) {
    return value;
  }

  throw new Error(`Unsupported notification type: ${value}`);
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1)}...`
    : value;
}
