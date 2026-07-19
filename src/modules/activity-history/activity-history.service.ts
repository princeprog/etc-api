import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  sql,
  type Kysely,
  type SelectQueryBuilder,
  type Transaction,
} from 'kysely';

import {
  buildPaginatedResponse,
  normalizeSearch,
  parsePageSize,
  parsePositiveInteger,
} from '../../common/utils/list-query.utils';
import type { CurrentUser } from '../../common/types/auth.types';
import { DATABASE } from '../../database/database.constants';
import type { DB, OpsActivityHistory } from '../../database/db';
import type { ActivityEntityType } from '../../database/schema';
import { buildCsv, buildExportFilename } from '../reports/reports.helpers';
import type { ListActivityHistoryQueryDto } from './dto/list-activity-history-query.dto';
import { mapActivityHistoryResponse } from './activity-history.helpers';
import type { WriteActivityHistoryInput } from './activity-history.types';

const ACTIVITY_ENTITY_TYPES = [
  'seller_lead',
  'buyer_lead',
  'vehicle',
  'sale',
  'follow_up',
  'user',
  'expense',
  'expense_category',
  'expense_recurring_rule',
] as const satisfies ActivityEntityType[];

const ACTIVITY_DATE_RANGES = [
  'all',
  'today',
  'last_7_days',
  'last_30_days',
  'this_month',
] as const;

type ActivityDateRange = (typeof ACTIVITY_DATE_RANGES)[number];

type ActivityHistoryFilters = {
  search?: string;
  entityType?: ActivityEntityType;
  actionType?: string;
  actor?: string;
  dateRange: ActivityDateRange;
};

type ActivityHistoryQueryBuilder = SelectQueryBuilder<
  DB,
  'ops.activity_history',
  OpsActivityHistory
>;

@Injectable()
export class ActivityHistoryService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async write(
    input: WriteActivityHistoryInput,
    executor?: Kysely<DB> | Transaction<DB>,
  ) {
    const db = executor ?? this.db;
    await db
      .insertInto('ops.activity_history')
      .values({
        actor_user_id: input.actor?.id ?? null,
        actor_display_name: input.actor?.fullName ?? null,
        entity_type: input.entityType,
        entity_id: input.entityId,
        action_type: input.actionType,
        summary: input.summary,
        metadata: input.metadata ?? null,
        created_at: input.createdAt ?? new Date(),
      })
      .execute();
  }

  async listForEntity(
    entityType: ActivityEntityType,
    entityId: string,
    currentUser: CurrentUser,
    query: ListActivityHistoryQueryDto = {},
  ) {
    const pagination = this.parseHistoryPagination(query, 50);
    const queryBuilder = this.buildVisibleEventsQuery(currentUser)
      .where('entity_type', '=', entityType)
      .where('entity_id', '=', entityId);

    const totalRow = await queryBuilder
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const total = Number(totalRow.count);
    const events = await this.buildVisibleEventsQuery(currentUser)
      .selectAll()
      .where('entity_type', '=', entityType)
      .where('entity_id', '=', entityId)
      .orderBy('created_at', 'desc')
      .offset(pagination.offset)
      .limit(pagination.pageSize)
      .execute();

    const response = buildPaginatedResponse(
      events.map(mapActivityHistoryResponse),
      pagination,
      total,
    );

    return {
      events: response.items,
      page: response.page,
      pageSize: response.pageSize,
      total: response.total,
      totalPages: response.totalPages,
    };
  }

  async listAll(
    currentUser: CurrentUser,
    query: ListActivityHistoryQueryDto = {},
  ) {
    const pagination = this.parseHistoryPagination(query, 100);
    const filters = this.normalizeFilters(query);

    const filteredQuery = this.applyFilters(
      this.buildVisibleEventsQuery(currentUser) as ActivityHistoryQueryBuilder,
      filters,
    );

    const totalRow = await filteredQuery
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const total = Number(totalRow.count);
    const events = await this.applyFilters(
      this.buildVisibleEventsQuery(currentUser) as ActivityHistoryQueryBuilder,
      filters,
    )
      .selectAll()
      .orderBy('created_at', 'desc')
      .offset(pagination.offset)
      .limit(pagination.pageSize)
      .execute();

    const response = buildPaginatedResponse(
      events.map(mapActivityHistoryResponse),
      pagination,
      total,
    );

    return {
      events: response.items,
      page: response.page,
      pageSize: response.pageSize,
      total: response.total,
      totalPages: response.totalPages,
    };
  }

  async getSummary(
    currentUser: CurrentUser,
    query: ListActivityHistoryQueryDto = {},
  ) {
    const filters = this.normalizeFilters(query);
    const [
      totalActivities,
      todaysEvents,
      vehicleUpdates,
      salesEvents,
      userActions,
      actors,
      actionTypes,
    ] = await Promise.all([
      this.countFilteredActivities(currentUser, filters),
      this.countFilteredActivities(currentUser, filters, (builder) =>
        this.applyTodayFilter(builder),
      ),
      this.countFilteredActivities(currentUser, filters, (builder) =>
        builder.where('entity_type', '=', 'vehicle'),
      ),
      this.countFilteredActivities(currentUser, filters, (builder) =>
        builder.where('entity_type', '=', 'sale'),
      ),
      this.countFilteredActivities(currentUser, filters, (builder) =>
        builder.where('entity_type', '=', 'user'),
      ),
      this.listActorOptions(currentUser, filters),
      this.listActionTypeOptions(currentUser, filters),
    ]);

    return {
      totalActivities,
      todaysEvents,
      vehicleUpdates,
      salesEvents,
      userActions,
      actors,
      actionTypes,
    };
  }

  async exportLogs(
    currentUser: CurrentUser,
    query: ListActivityHistoryQueryDto = {},
  ) {
    const filters = this.normalizeFilters(query);
    const events = await this.applyFilters(
      this.buildVisibleEventsQuery(currentUser) as ActivityHistoryQueryBuilder,
      filters,
    )
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute();

    const rows = events.map(mapActivityHistoryResponse);
    const csv = buildCsv(
      [
        {
          header: 'Time',
          value: (row) => new Date(row.timestamp).toISOString(),
        },
        { header: 'Event', value: (row) => row.summary },
        { header: 'Module', value: (row) => row.entityType },
        { header: 'Action Type', value: (row) => row.actionType },
        { header: 'User', value: (row) => row.actorDisplayName ?? 'System' },
        { header: 'Entity ID', value: (row) => row.entityId },
        {
          header: 'Metadata',
          value: (row) =>
            Object.keys(row.metadata).length
              ? JSON.stringify(row.metadata)
              : '',
        },
      ],
      rows,
    );

    return {
      filename: buildExportFilename('activity-history', 'logs'),
      csv,
    };
  }

  private buildVisibleEventsQuery(currentUser: CurrentUser) {
    let query = this.db.selectFrom('ops.activity_history');

    if (currentUser.role === 'staff') {
      query = query.where(({ not, and, eb }) =>
        not(
          and([
            eb('entity_type', '=', 'user'),
            eb('action_type', '=', 'user.status_changed'),
          ]),
        ),
      );
    }

    return query;
  }

  private parseHistoryPagination(
    query: ListActivityHistoryQueryDto,
    defaultPageSize: number,
  ) {
    const resolvedPageSize = query.pageSize ?? query.limit ?? defaultPageSize;

    return {
      page: parsePositiveInteger(query.page, 'page', 1),
      pageSize: parsePageSize(resolvedPageSize),
      offset:
        (parsePositiveInteger(query.page, 'page', 1) - 1) *
        parsePageSize(resolvedPageSize),
    };
  }

  private normalizeFilters(
    query: ListActivityHistoryQueryDto,
  ): ActivityHistoryFilters {
    return {
      search: normalizeSearch(query.search),
      entityType: this.parseOptionalEntityType(query.entityType),
      actionType: this.parseOptionalText(query.actionType),
      actor: this.parseOptionalText(query.actor),
      dateRange: this.parseDateRange(query.dateRange),
    };
  }

  private createFilteredActivityQuery(filters: ActivityHistoryFilters) {
    return this.applyFilters(
      this.db.selectFrom('ops.activity_history') as ActivityHistoryQueryBuilder,
      filters,
    );
  }

  private applyFilters(
    builder: ActivityHistoryQueryBuilder,
    filters: ActivityHistoryFilters,
  ) {
    let query = builder;

    if (filters.search) {
      const pattern = `%${filters.search.toLowerCase()}%`;
      query = query.where((eb) =>
        eb.or([
          eb(sql`lower(summary)`, 'like', pattern),
          eb(sql`lower(entity_id)`, 'like', pattern),
          eb(sql`lower(action_type)`, 'like', pattern),
          eb(sql`lower(entity_type)`, 'like', pattern),
          eb(
            sql`lower(coalesce(actor_display_name, 'System'))`,
            'like',
            pattern,
          ),
        ]),
      );
    }

    if (filters.entityType) {
      query = query.where('entity_type', '=', filters.entityType);
    }

    if (filters.actionType) {
      query = query.where('action_type', '=', filters.actionType);
    }

    if (filters.actor) {
      query = query.where(
        sql`lower(coalesce(actor_display_name, 'System'))`,
        '=',
        filters.actor.toLowerCase(),
      );
    }

    return this.applyDateRangeFilter(query, filters.dateRange);
  }

  private applyDateRangeFilter(
    builder: ActivityHistoryQueryBuilder,
    dateRange: ActivityDateRange,
  ) {
    switch (dateRange) {
      case 'today':
        return this.applyTodayFilter(builder);
      case 'last_7_days':
        return builder.where('created_at', '>=', this.daysAgo(7));
      case 'last_30_days':
        return builder.where('created_at', '>=', this.daysAgo(30));
      case 'this_month':
        return builder.where(
          'created_at',
          '>=',
          sql<Date>`date_trunc('month', now())`,
        );
      case 'all':
      default:
        return builder;
    }
  }

  private applyTodayFilter(builder: ActivityHistoryQueryBuilder) {
    return builder.where(
      sql`date_trunc('day', created_at)`,
      '=',
      sql`date_trunc('day', now())`,
    );
  }

  private async countFilteredActivities(
    currentUser: CurrentUser,
    filters: ActivityHistoryFilters,
    decorate?: (
      builder: ActivityHistoryQueryBuilder,
    ) => ActivityHistoryQueryBuilder,
  ) {
    const baseQuery = this.applyFilters(
      this.buildVisibleEventsQuery(currentUser) as ActivityHistoryQueryBuilder,
      filters,
    );
    const query = decorate ? decorate(baseQuery) : baseQuery;
    const row = await query
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();

    return Number(row.count);
  }

  private async listActorOptions(
    currentUser: CurrentUser,
    filters: ActivityHistoryFilters,
  ) {
    const rows = await this.applyFilters(
      this.buildVisibleEventsQuery(currentUser) as ActivityHistoryQueryBuilder,
      filters,
    )
      .select(sql<string>`coalesce(actor_display_name, 'System')`.as('name'))
      .groupBy(sql`coalesce(actor_display_name, 'System')`)
      .orderBy('name')
      .execute();

    return rows.map((row) => ({
      value: row.name,
      label: row.name,
    }));
  }

  private async listActionTypeOptions(
    currentUser: CurrentUser,
    filters: ActivityHistoryFilters,
  ) {
    const rows = await this.applyFilters(
      this.buildVisibleEventsQuery(currentUser) as ActivityHistoryQueryBuilder,
      filters,
    )
      .select('action_type as value')
      .groupBy('action_type')
      .orderBy('action_type')
      .execute();

    return rows.map((row) => ({
      value: row.value,
      label: row.value,
    }));
  }

  private parseOptionalEntityType(value: string | undefined) {
    const normalized = this.parseOptionalText(value);

    if (!normalized) {
      return undefined;
    }

    if (ACTIVITY_ENTITY_TYPES.includes(normalized as ActivityEntityType)) {
      return normalized as ActivityEntityType;
    }

    throw new BadRequestException(
      `entityType must be one of: ${ACTIVITY_ENTITY_TYPES.join(', ')}`,
    );
  }

  private parseDateRange(value: string | undefined): ActivityDateRange {
    const normalized = value?.trim();

    if (!normalized || normalized === 'all') {
      return 'all';
    }

    if (ACTIVITY_DATE_RANGES.includes(normalized as ActivityDateRange)) {
      return normalized as ActivityDateRange;
    }

    throw new BadRequestException(
      `dateRange must be one of: ${ACTIVITY_DATE_RANGES.join(', ')}`,
    );
  }

  private parseOptionalText(value: string | undefined) {
    const trimmed = value?.trim();

    if (!trimmed || trimmed === 'all') {
      return undefined;
    }

    return trimmed;
  }

  private daysAgo(days: number) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }
}
