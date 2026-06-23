import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';

import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import type { ActivityEntityType } from '../../database/schema';
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

  async listForEntity(entityType: ActivityEntityType, entityId: string, limit = 50) {
    const events = await this.db
      .selectFrom('ops.activity_history')
      .selectAll()
      .where('entity_type', '=', entityType)
      .where('entity_id', '=', entityId)
      .orderBy('created_at', 'desc')
      .limit(Math.min(Math.max(limit, 1), 100))
      .execute();

    return {
      events: events.map(mapActivityHistoryResponse),
    };
  }

  async listAll(limit = 100) {
    const events = await this.db
      .selectFrom('ops.activity_history')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(Math.min(Math.max(limit, 1), 200))
      .execute();

    return {
      events: events.map(mapActivityHistoryResponse),
    };
  }
}
