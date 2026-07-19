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
import type { ExpenseRuleFrequency } from '../../database/schema';
import { ActivityHistoryService } from '../activity-history/activity-history.service';
import type { CreateExpenseRecurringRuleDto } from './dto/create-expense-recurring-rule.dto';
import type { ListExpenseRecurringRulesQueryDto } from './dto/list-expense-recurring-rules-query.dto';
import type { UpdateExpenseRecurringRuleDto } from './dto/update-expense-recurring-rule.dto';
import { mapExpenseCategory } from './expense-categories.service';
import {
  addDaysToDateKey,
  dateKeyToUtcDate,
  formatDateKey,
  getAppTimeZone,
  getDaysInMonth,
  getIsoWeekPeriodKey,
  getIsoWeekday,
  getMonthlyPeriodKey,
  getTodayDateKey,
  getUtcDateParts,
  getYearlyPeriodKey,
  normalizeMoneyAmount,
  normalizeOptionalTrimmed,
  parseBoolean,
  parseDateOnly,
  parseExpenseRuleFrequency,
  parseOptionalDateOnly,
  parsePositiveInteger,
  requireTrimmed,
} from './expenses.helpers';
import type { ExpenseRecurringRuleResponse } from './expenses.types';

const UNIQUE_VIOLATION_CODE = '23505';
const RECURRING_LOOKAHEAD_DAYS = 35;

type RecurringRuleJoinedRow = {
  id: string;
  title: string;
  category_id: string;
  expected_amount: string;
  frequency: string;
  due_day: number;
  start_date: Date;
  end_date: Date | null;
  vendor_name: string | null;
  assigned_staff_id: string | null;
  notes: string | null;
  is_active: boolean;
  created_by_user_id: string;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  category_name: string;
  category_description: string | null;
  category_is_default: boolean;
  category_is_active: boolean;
  category_created_at: Date;
  category_updated_at: Date;
  assigned_staff_full_name: string | null;
  assigned_staff_email: string | null;
  assigned_staff_active: boolean | null;
};

type RecurringRuleRecord = {
  id: string;
  title: string;
  category_id: string;
  expected_amount: string;
  frequency: string;
  due_day: number;
  start_date: Date;
  end_date: Date | null;
  vendor_name: string | null;
  assigned_staff_id: string | null;
  notes: string | null;
  is_active: boolean;
  created_by_user_id: string;
  updated_by_user_id: string | null;
};

@Injectable()
export class ExpenseRecurringRulesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExpenseRecurringRulesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly activityHistoryService: ActivityHistoryService,
  ) {}

  async onApplicationBootstrap() {
    await this.generateDueInstances().catch((error: unknown) => {
      this.logger.error(
        'Failed to generate recurring expenses on bootstrap',
        error,
      );
    });
  }

  @Cron('10 0 * * *', { timeZone: getAppTimeZone() })
  async runDailyGeneration() {
    await this.generateDueInstances();
  }

  async list(query: ListExpenseRecurringRulesQueryDto) {
    let rulesQuery = this.baseRuleQuery();

    const search = query.search?.trim();
    if (search) {
      rulesQuery = rulesQuery.where((eb) =>
        eb.or([
          eb('finance.expense_recurring_rules.title', 'ilike', `%${search}%`),
          eb(
            'finance.expense_recurring_rules.vendor_name',
            'ilike',
            `%${search}%`,
          ),
          eb('finance.expense_categories.name', 'ilike', `%${search}%`),
        ]),
      );
    }

    if (query.categoryId) {
      rulesQuery = rulesQuery.where(
        'finance.expense_recurring_rules.category_id',
        '=',
        query.categoryId.trim(),
      );
    }

    if (query.frequency) {
      rulesQuery = rulesQuery.where(
        'finance.expense_recurring_rules.frequency',
        '=',
        parseExpenseRuleFrequency(query.frequency),
      );
    }

    if (query.assignedStaffId) {
      rulesQuery = rulesQuery.where(
        'finance.expense_recurring_rules.assigned_staff_id',
        '=',
        query.assignedStaffId.trim(),
      );
    }

    if (!parseBoolean(query.includeInactive)) {
      rulesQuery = rulesQuery.where(
        'finance.expense_recurring_rules.is_active',
        '=',
        true,
      );
    }

    const rules = await rulesQuery
      .orderBy('finance.expense_recurring_rules.is_active', 'desc')
      .orderBy('finance.expense_recurring_rules.due_day', 'asc')
      .orderBy(sql`lower(finance.expense_recurring_rules.title)`, 'asc')
      .execute();

    return { rules: rules.map((rule) => this.mapRule(rule)) };
  }

  async findOne(id: string) {
    const rule = await this.baseRuleQuery()
      .where(
        'finance.expense_recurring_rules.id',
        '=',
        requireTrimmed(id, 'id'),
      )
      .executeTakeFirst();

    if (!rule) {
      throw new NotFoundException('Recurring expense rule was not found');
    }

    return { rule: this.mapRule(rule) };
  }

  async create(user: CurrentUser, dto: CreateExpenseRecurringRuleDto) {
    const model = await this.normalizeRuleModel(dto);

    const rule = await this.db
      .insertInto('finance.expense_recurring_rules')
      .values({
        ...model,
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    await this.activityHistoryService.write({
      actor: user,
      entityType: 'expense_recurring_rule',
      entityId: rule.id,
      actionType: 'expense_recurring_rule.created',
      summary: 'Recurring expense rule created',
      metadata: {
        title: model.title,
        frequency: model.frequency,
        dueDay: model.due_day,
        expectedAmount: model.expected_amount,
      },
    });

    await this.generateDueInstancesForRule(rule.id);
    return this.findOne(rule.id);
  }

  async update(
    user: CurrentUser,
    id: string,
    dto: UpdateExpenseRecurringRuleDto,
  ) {
    const ruleId = requireTrimmed(id, 'id');
    const existing = await this.getRuleForMutation(ruleId);
    const model = await this.normalizeRuleModel(dto, existing);
    const isActive = this.resolveOptionalBoolean(
      dto.isActive,
      existing.is_active,
    );

    await this.db
      .updateTable('finance.expense_recurring_rules')
      .set({
        ...model,
        is_active: isActive,
        updated_by_user_id: user.id,
        updated_at: new Date(),
      })
      .where('id', '=', ruleId)
      .execute();

    await this.activityHistoryService.write({
      actor: user,
      entityType: 'expense_recurring_rule',
      entityId: ruleId,
      actionType: 'expense_recurring_rule.updated',
      summary: 'Recurring expense rule updated',
      metadata: {
        title: model.title,
        frequency: model.frequency,
        dueDay: model.due_day,
        expectedAmount: model.expected_amount,
        isActive,
      },
    });

    if (isActive) {
      await this.generateDueInstancesForRule(ruleId);
    }

    return this.findOne(ruleId);
  }

  async deactivate(user: CurrentUser, id: string) {
    const ruleId = requireTrimmed(id, 'id');
    const existing = await this.getRuleForMutation(ruleId);

    if (!existing.is_active) {
      return this.findOne(ruleId);
    }

    await this.db
      .updateTable('finance.expense_recurring_rules')
      .set({
        is_active: false,
        updated_by_user_id: user.id,
        updated_at: new Date(),
      })
      .where('id', '=', ruleId)
      .execute();

    await this.activityHistoryService.write({
      actor: user,
      entityType: 'expense_recurring_rule',
      entityId: ruleId,
      actionType: 'expense_recurring_rule.deactivated',
      summary: 'Recurring expense rule deactivated',
      metadata: { title: existing.title },
    });

    return this.findOne(ruleId);
  }

  async generateDueInstances() {
    const todayKey = getTodayDateKey();
    const rangeEndKey = addDaysToDateKey(todayKey, RECURRING_LOOKAHEAD_DAYS);
    const rules = await this.db
      .selectFrom('finance.expense_recurring_rules')
      .selectAll()
      .where('is_active', '=', true)
      .where('start_date', '<=', dateKeyToUtcDate(rangeEndKey))
      .$if(true, (qb) =>
        qb.where((eb) =>
          eb.or([
            eb('end_date', 'is', null),
            eb('end_date', '>=', dateKeyToUtcDate(todayKey)),
          ]),
        ),
      )
      .execute();

    let created = 0;
    for (const rule of rules) {
      created += await this.generateInstancesForRule(
        rule,
        todayKey,
        rangeEndKey,
      );
    }

    return { created };
  }

  async generateDueInstancesForRule(ruleId: string) {
    const rule = await this.getRuleForMutation(ruleId);

    if (!rule.is_active) {
      return { created: 0 };
    }

    const todayKey = getTodayDateKey();
    const rangeEndKey = addDaysToDateKey(todayKey, RECURRING_LOOKAHEAD_DAYS);
    return {
      created: await this.generateInstancesForRule(rule, todayKey, rangeEndKey),
    };
  }

  private async generateInstancesForRule(
    rule: RecurringRuleRecord,
    todayKey: string,
    rangeEndKey: string,
  ) {
    let created = 0;
    const startKey =
      formatDateKey(rule.start_date, 'UTC') > todayKey
        ? formatDateKey(rule.start_date, 'UTC')
        : todayKey;

    for (
      let dateKey = startKey;
      dateKey <= rangeEndKey;
      dateKey = addDaysToDateKey(dateKey, 1)
    ) {
      if (!this.shouldGenerateOnDate(rule, dateKey)) {
        continue;
      }

      if (rule.end_date && dateKey > formatDateKey(rule.end_date, 'UTC')) {
        continue;
      }

      const inserted = await this.insertGeneratedExpense(rule, dateKey);
      if (inserted) {
        created += 1;
      }
    }

    return created;
  }

  private shouldGenerateOnDate(rule: RecurringRuleRecord, dateKey: string) {
    const frequency = parseExpenseRuleFrequency(rule.frequency);
    const { year, month, day } = getUtcDateParts(dateKey);

    if (frequency === 'weekly') {
      return getIsoWeekday(dateKey) === rule.due_day;
    }

    if (frequency === 'monthly') {
      return day === Math.min(rule.due_day, getDaysInMonth(year, month));
    }

    const startMonth = getUtcDateParts(
      formatDateKey(rule.start_date, 'UTC'),
    ).month;
    return (
      month === startMonth &&
      day === Math.min(rule.due_day, getDaysInMonth(year, month))
    );
  }

  private async insertGeneratedExpense(
    rule: RecurringRuleRecord,
    dateKey: string,
  ) {
    const frequency = parseExpenseRuleFrequency(rule.frequency);
    const billingPeriodKey = this.getBillingPeriodKey(frequency, dateKey);

    try {
      await this.db
        .insertInto('finance.expenses')
        .values({
          recurring_rule_id: rule.id,
          billing_period_key: billingPeriodKey,
          title: rule.title,
          category_id: rule.category_id,
          expected_amount: rule.expected_amount,
          due_date: dateKeyToUtcDate(dateKey),
          status: 'unpaid',
          vendor_name: rule.vendor_name,
          assigned_staff_id: rule.assigned_staff_id,
          notes: rule.notes,
          created_by_user_id: rule.created_by_user_id,
          updated_by_user_id:
            rule.updated_by_user_id ?? rule.created_by_user_id,
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

  private getBillingPeriodKey(
    frequency: ExpenseRuleFrequency,
    dateKey: string,
  ) {
    switch (frequency) {
      case 'weekly':
        return getIsoWeekPeriodKey(dateKey);
      case 'monthly':
        return getMonthlyPeriodKey(dateKey);
      case 'yearly':
        return getYearlyPeriodKey(dateKey);
    }
  }

  private async normalizeRuleModel(
    input: CreateExpenseRecurringRuleDto | UpdateExpenseRecurringRuleDto,
    existing?: RecurringRuleRecord,
  ) {
    const title =
      input.title !== undefined
        ? requireTrimmed(input.title, 'title')
        : existing?.title;
    const categoryId =
      input.categoryId !== undefined
        ? requireTrimmed(input.categoryId, 'categoryId')
        : existing?.category_id;
    const expectedAmount =
      input.expectedAmount !== undefined
        ? normalizeMoneyAmount(input.expectedAmount, 'expectedAmount')
        : existing?.expected_amount;
    const frequency =
      input.frequency !== undefined
        ? parseExpenseRuleFrequency(input.frequency)
        : existing
          ? parseExpenseRuleFrequency(existing.frequency)
          : undefined;
    const startDate =
      input.startDate !== undefined
        ? parseDateOnly(input.startDate, 'startDate')
        : existing?.start_date;

    if (!title) {
      throw new BadRequestException('title is required');
    }

    if (!categoryId) {
      throw new BadRequestException('categoryId is required');
    }

    if (!expectedAmount) {
      throw new BadRequestException('expectedAmount is required');
    }

    if (!frequency) {
      throw new BadRequestException('frequency is required');
    }

    if (!startDate) {
      throw new BadRequestException('startDate is required');
    }

    await this.ensureActiveCategory(categoryId);

    const dueDay =
      input.dueDay !== undefined
        ? parsePositiveInteger(input.dueDay, 1, 'dueDay', {
            min: 1,
            max: frequency === 'weekly' ? 7 : 31,
          })
        : existing?.due_day;

    if (!dueDay) {
      throw new BadRequestException('dueDay is required');
    }

    if (frequency === 'weekly' && dueDay > 7) {
      throw new BadRequestException(
        'dueDay must be 1-7 for weekly recurring expenses',
      );
    }

    const endDate =
      input.endDate !== undefined
        ? parseOptionalDateOnly(input.endDate, 'endDate')
        : (existing?.end_date ?? null);

    if (endDate && endDate < startDate) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const assignedStaffId =
      input.assignedStaffId !== undefined
        ? normalizeOptionalTrimmed(input.assignedStaffId)
        : (existing?.assigned_staff_id ?? null);

    if (assignedStaffId) {
      await this.ensureActiveStaff(assignedStaffId);
    }

    return {
      title,
      category_id: categoryId,
      expected_amount: expectedAmount,
      frequency,
      due_day: dueDay,
      start_date: startDate,
      end_date: endDate,
      vendor_name:
        input.vendorName !== undefined
          ? normalizeOptionalTrimmed(input.vendorName)
          : (existing?.vendor_name ?? null),
      assigned_staff_id: assignedStaffId,
      notes:
        input.notes !== undefined
          ? normalizeOptionalTrimmed(input.notes)
          : (existing?.notes ?? null),
    };
  }

  private resolveOptionalBoolean(value: unknown, fallback: boolean) {
    if (value === undefined) {
      return fallback;
    }

    if (typeof value !== 'boolean') {
      throw new BadRequestException('isActive must be true or false');
    }

    return value;
  }

  private async getRuleForMutation(id: string): Promise<RecurringRuleRecord> {
    const rule = await this.db
      .selectFrom('finance.expense_recurring_rules')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!rule) {
      throw new NotFoundException('Recurring expense rule was not found');
    }

    return rule;
  }

  private async ensureActiveCategory(categoryId: string) {
    const category = await this.db
      .selectFrom('finance.expense_categories')
      .select(['id', 'is_active'])
      .where('id', '=', categoryId)
      .executeTakeFirst();

    if (!category || !category.is_active) {
      throw new BadRequestException('Select an active expense category');
    }
  }

  private async ensureActiveStaff(userId: string) {
    const staff = await this.db
      .selectFrom('authentication.users')
      .select(['id'])
      .where('id', '=', userId)
      .where('role', '=', 'staff')
      .where('active', '=', true)
      .executeTakeFirst();

    if (!staff) {
      throw new BadRequestException('Assigned staff member must be active');
    }
  }

  private baseRuleQuery() {
    return this.db
      .selectFrom('finance.expense_recurring_rules')
      .innerJoin(
        'finance.expense_categories',
        'finance.expense_categories.id',
        'finance.expense_recurring_rules.category_id',
      )
      .leftJoin(
        'authentication.users as assigned_staff',
        'assigned_staff.id',
        'finance.expense_recurring_rules.assigned_staff_id',
      )
      .select([
        'finance.expense_recurring_rules.id as id',
        'finance.expense_recurring_rules.title as title',
        'finance.expense_recurring_rules.category_id as category_id',
        'finance.expense_recurring_rules.expected_amount as expected_amount',
        'finance.expense_recurring_rules.frequency as frequency',
        'finance.expense_recurring_rules.due_day as due_day',
        'finance.expense_recurring_rules.start_date as start_date',
        'finance.expense_recurring_rules.end_date as end_date',
        'finance.expense_recurring_rules.vendor_name as vendor_name',
        'finance.expense_recurring_rules.assigned_staff_id as assigned_staff_id',
        'finance.expense_recurring_rules.notes as notes',
        'finance.expense_recurring_rules.is_active as is_active',
        'finance.expense_recurring_rules.created_by_user_id as created_by_user_id',
        'finance.expense_recurring_rules.updated_by_user_id as updated_by_user_id',
        'finance.expense_recurring_rules.created_at as created_at',
        'finance.expense_recurring_rules.updated_at as updated_at',
        'finance.expense_categories.name as category_name',
        'finance.expense_categories.description as category_description',
        'finance.expense_categories.is_default as category_is_default',
        'finance.expense_categories.is_active as category_is_active',
        'finance.expense_categories.created_at as category_created_at',
        'finance.expense_categories.updated_at as category_updated_at',
        'assigned_staff.full_name as assigned_staff_full_name',
        'assigned_staff.email as assigned_staff_email',
        'assigned_staff.active as assigned_staff_active',
      ]);
  }

  private mapRule(row: RecurringRuleJoinedRow): ExpenseRecurringRuleResponse {
    return {
      id: row.id,
      title: row.title,
      categoryId: row.category_id,
      category: mapExpenseCategory({
        id: row.category_id,
        name: row.category_name,
        description: row.category_description,
        is_default: row.category_is_default,
        is_active: row.category_is_active,
        created_at: row.category_created_at,
        updated_at: row.category_updated_at,
      }),
      expectedAmount: row.expected_amount,
      frequency: parseExpenseRuleFrequency(row.frequency),
      dueDay: row.due_day,
      startDate: row.start_date,
      endDate: row.end_date,
      vendorName: row.vendor_name,
      assignedStaffId: row.assigned_staff_id,
      assignedStaff:
        row.assigned_staff_id &&
        row.assigned_staff_full_name &&
        row.assigned_staff_email
          ? {
              id: row.assigned_staff_id,
              fullName: row.assigned_staff_full_name,
              email: row.assigned_staff_email,
              active: Boolean(row.assigned_staff_active),
            }
          : null,
      notes: row.notes,
      isActive: row.is_active,
      createdByUserId: row.created_by_user_id,
      updatedByUserId: row.updated_by_user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private isDatabaseError(error: unknown): error is { code?: string } {
    return typeof error === 'object' && error !== null && 'code' in error;
  }
}
