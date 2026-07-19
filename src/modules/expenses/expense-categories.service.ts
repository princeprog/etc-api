import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import type { CurrentUser } from '../../common/types/auth.types';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { ActivityHistoryService } from '../activity-history/activity-history.service';
import { normalizeOptionalTrimmed, requireTrimmed } from './expenses.helpers';
import type { ExpenseCategoryResponse } from './expenses.types';

const UNIQUE_VIOLATION_CODE = '23505';

@Injectable()
export class ExpenseCategoriesService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly activityHistoryService: ActivityHistoryService,
  ) {}

  async list(options: { includeInactive?: boolean } = {}) {
    const categories = await this.db
      .selectFrom('finance.expense_categories')
      .selectAll()
      .$if(!options.includeInactive, (qb) => qb.where('is_active', '=', true))
      .orderBy('is_default', 'desc')
      .orderBy(sql`lower(name)`, 'asc')
      .execute();

    return {
      categories: categories.map(mapExpenseCategory),
    };
  }

  async create(
    user: CurrentUser,
    input: { name?: string; description?: string | null },
  ) {
    const name = requireTrimmed(input.name, 'name');
    const description = normalizeOptionalTrimmed(input.description);

    try {
      const category = await this.db
        .insertInto('finance.expense_categories')
        .values({
          name,
          description,
          is_default: false,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.activityHistoryService.write({
        actor: user,
        entityType: 'expense_category',
        entityId: category.id,
        actionType: 'expense_category.created',
        summary: 'Expense category created',
        metadata: { name: category.name },
      });

      return { category: mapExpenseCategory(category) };
    } catch (error) {
      this.throwDuplicateError(
        error,
        `Expense category "${name}" already exists`,
      );
      throw error;
    }
  }

  async update(
    user: CurrentUser,
    id: string,
    input: {
      name?: string;
      description?: string | null;
      isActive?: boolean;
    },
  ) {
    const update: {
      name?: string;
      description?: string | null;
      is_active?: boolean;
      updated_at: Date;
    } = { updated_at: new Date() };

    if (input.name !== undefined) {
      update.name = requireTrimmed(input.name, 'name');
    }

    if (input.description !== undefined) {
      update.description = normalizeOptionalTrimmed(input.description);
    }

    if (input.isActive !== undefined) {
      if (typeof input.isActive !== 'boolean') {
        throw new BadRequestException('isActive must be true or false');
      }
      update.is_active = input.isActive;
    }

    if (
      update.name === undefined &&
      update.description === undefined &&
      update.is_active === undefined
    ) {
      throw new BadRequestException(
        'At least one category field must be changed',
      );
    }

    try {
      const category = await this.db
        .updateTable('finance.expense_categories')
        .set(update)
        .where('id', '=', requireTrimmed(id, 'id'))
        .returningAll()
        .executeTakeFirst();

      if (!category) {
        throw new NotFoundException('Expense category was not found');
      }

      await this.activityHistoryService.write({
        actor: user,
        entityType: 'expense_category',
        entityId: category.id,
        actionType: 'expense_category.updated',
        summary: 'Expense category updated',
        metadata: {
          name: category.name,
          isActive: category.is_active,
        },
      });

      return { category: mapExpenseCategory(category) };
    } catch (error) {
      this.throwDuplicateError(
        error,
        `Expense category "${input.name ?? ''}" already exists`,
      );
      throw error;
    }
  }

  private throwDuplicateError(error: unknown, message: string) {
    if (this.isDatabaseError(error) && error.code === UNIQUE_VIOLATION_CODE) {
      throw new BadRequestException(message);
    }
  }

  private isDatabaseError(error: unknown): error is { code?: string } {
    return typeof error === 'object' && error !== null && 'code' in error;
  }
}

export function mapExpenseCategory(row: {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}): ExpenseCategoryResponse {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isDefault: row.is_default,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
