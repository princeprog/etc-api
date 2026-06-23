import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';

import {
  buildPaginatedResponse,
  parsePageSize,
  parsePositiveInteger,
} from '../../common/utils/list-query.utils';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import type { ActivityEntityType } from '../../database/schema';
import type { ListActivityHistoryQueryDto } from './dto/list-activity-history-query.dto';
import { mapActivityHistoryResponse } from './activity-history.helpers';
import type { WriteActivityHistoryInput } from './activity-history.types';

@Injectable()
export class ActivityHistoryService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async write(input: WriteActivityHistoryInput, executor?: Kysely<DB> | Transaction<DB>) {
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
    query: ListActivityHistoryQueryDto = {},
  ) {
    const pagination = this.parseHistoryPagination(query, 50);

    const totalRow = await this.db
      .selectFrom('ops.activity_history')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('entity_type', '=', entityType)
      .where('entity_id', '=', entityId)
      .executeTakeFirstOrThrow();
    const total = Number(totalRow.count);
    const events = await this.db
      .selectFrom('ops.activity_history')
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

  async listAll(query: ListActivityHistoryQueryDto = {}) {
    const pagination = this.parseHistoryPagination(query, 100);

    const totalRow = await this.db
      .selectFrom('ops.activity_history')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const total = Number(totalRow.count);
    const events = await this.db
      .selectFrom('ops.activity_history')
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

  private parseHistoryPagination(
    query: ListActivityHistoryQueryDto,
    defaultPageSize: number,
  ) {
    const resolvedPageSize =
      query.pageSize ?? query.limit ?? defaultPageSize;

    return {
      page: parsePositiveInteger(query.page, 'page', 1),
      pageSize: parsePageSize(resolvedPageSize),
      offset:
        (parsePositiveInteger(query.page, 'page', 1) - 1) *
        parsePageSize(resolvedPageSize),
    };
  }
}
