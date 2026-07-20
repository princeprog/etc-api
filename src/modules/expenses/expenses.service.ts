import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import type { CurrentUser } from '../../common/types/auth.types';
import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { ActivityHistoryService } from '../activity-history/activity-history.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExpenseReceiptStorageService } from '../../common/storage/expense-receipt-storage.service';
import type { CreateExpenseDto } from './dto/create-expense.dto';
import type { ExpenseReceiptDto } from './dto/expense-receipt.dto';
import type { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import type { MarkExpensePaidDto } from './dto/mark-expense-paid.dto';
import type { UpdateExpenseDto } from './dto/update-expense.dto';
import type { VoidExpenseDto } from './dto/void-expense.dto';
import { mapExpenseCategory } from './expense-categories.service';
import {
  formatDateKey,
  normalizeMoneyAmount,
  normalizeOptionalTrimmed,
  parseDateOnly,
  parseExpenseDisplayStatus,
  parseExpenseFrequency,
  parseExpenseSettlementStatus,
  parseOptionalDateOnly,
  parseOptionalDateTime,
  parsePositiveInteger,
  requireTrimmed,
  resolveExpenseDisplayStatus,
} from './expenses.helpers';
import type { ExpenseListResponse, ExpenseResponse } from './expenses.types';

type ExpenseJoinedRow = {
  id: string;
  recurring_rule_id: string | null;
  billing_period_key: string | null;
  title: string;
  category_id: string;
  expected_amount: string;
  actual_paid_amount: string | null;
  expense_date: Date | null;
  due_date: Date;
  paid_at: Date | null;
  status: string;
  vendor_name: string | null;
  assigned_staff_id: string | null;
  payment_method: string | null;
  reference_number: string | null;
  notes: string | null;
  voided_at: Date | null;
  void_reason: string | null;
  receipt_file_url: string | null;
  receipt_public_id: string | null;
  receipt_original_filename: string | null;
  receipt_mime_type: string | null;
  receipt_file_size: number | null;
  receipt_uploaded_at: Date | null;
  receipt_uploaded_by_user_id: string | null;
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
  recurring_frequency: string | null;
};

type ExpenseReceiptModel = {
  receipt_file_url: string;
  receipt_public_id: string | null;
  receipt_original_filename: string | null;
  receipt_mime_type: string | null;
  receipt_file_size: number | null;
  receipt_uploaded_at: Date;
  receipt_uploaded_by_user_id: string;
};

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<DB>,
    private readonly activityHistoryService: ActivityHistoryService,
    private readonly notificationsService: NotificationsService,
    private readonly expenseReceiptStorageService: ExpenseReceiptStorageService,
  ) {}

  async list(query: ListExpensesQueryDto): Promise<ExpenseListResponse> {
    const page = parsePositiveInteger(query.page, 1, 'page', {
      min: 1,
      max: 1000,
    });
    const pageSize = parsePositiveInteger(query.pageSize, 25, 'pageSize', {
      min: 1,
      max: 100,
    });
    const offset = (page - 1) * pageSize;

    const [rows, totalRow] = await Promise.all([
      this.applySorting(
        this.applyFilters(this.baseExpenseQuery(), query),
        query,
      )
        .limit(pageSize)
        .offset(offset)
        .execute(),
      this.applyFilters(
        this.baseExpenseCountQuery(),
        query,
      ).executeTakeFirstOrThrow(),
    ]);
    const total = Number(totalRow.total);

    return {
      expenses: rows.map((row) => this.mapExpense(row)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async findOne(id: string) {
    const expense = await this.baseExpenseQuery()
      .where('finance.expenses.id', '=', requireTrimmed(id, 'id'))
      .executeTakeFirst();

    if (!expense) {
      throw new NotFoundException('Expense was not found');
    }

    return { expense: this.mapExpense(expense) };
  }

  async create(user: CurrentUser, dto: CreateExpenseDto) {
    const frequency = parseExpenseFrequency(dto.frequency, 'one_time');

    if (frequency !== 'one_time') {
      throw new BadRequestException(
        'Use recurring expense rules for weekly, monthly, or yearly expenses',
      );
    }

    const model = await this.normalizeExpenseModel(dto);
    const expense = await this.db
      .insertInto('finance.expenses')
      .values({
        ...model,
        status: 'unpaid',
        created_by_user_id: user.id,
        updated_by_user_id: user.id,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    await this.activityHistoryService.write({
      actor: user,
      entityType: 'expense',
      entityId: expense.id,
      actionType: 'expense.created',
      summary: 'Expense created',
      metadata: {
        title: model.title,
        expectedAmount: model.expected_amount,
        dueDate: formatDateKey(model.due_date, 'UTC'),
      },
    });

    await this.notificationsService.refreshForExpense(expense.id);
    return this.findOne(expense.id);
  }

  async update(user: CurrentUser, id: string, dto: UpdateExpenseDto) {
    const expenseId = requireTrimmed(id, 'id');
    const existing = await this.getExpenseForMutation(expenseId);

    if (existing.status !== 'unpaid') {
      throw new BadRequestException('Only unpaid expenses can be edited');
    }

    const canEditExpense =
      user.role === 'admin' || existing.assigned_staff_id === user.id;

    if (!canEditExpense) {
      throw new ForbiddenException(
        'Only admins or assigned staff can edit this expense',
      );
    }

    const previousDueDate = formatDateKey(existing.due_date, 'UTC');
    const previousAssigneeId = existing.assigned_staff_id;
    const model = await this.normalizeExpenseModel(
      user.role === 'admin'
        ? dto
        : { ...dto, assignedStaffId: existing.assigned_staff_id },
      existing,
    );

    await this.db
      .updateTable('finance.expenses')
      .set({
        ...model,
        updated_by_user_id: user.id,
        updated_at: new Date(),
      })
      .where('id', '=', expenseId)
      .execute();

    await this.activityHistoryService.write({
      actor: user,
      entityType: 'expense',
      entityId: expenseId,
      actionType: 'expense.updated',
      summary: 'Expense updated',
      metadata: {
        title: model.title,
        expectedAmount: model.expected_amount,
        dueDate: formatDateKey(model.due_date, 'UTC'),
      },
    });

    if (
      previousDueDate !== formatDateKey(model.due_date, 'UTC') ||
      previousAssigneeId !== model.assigned_staff_id
    ) {
      await this.notificationsService.refreshForExpense(expenseId);
    }

    return this.findOne(expenseId);
  }

  async markPaid(user: CurrentUser, id: string, dto: MarkExpensePaidDto) {
    const expenseId = requireTrimmed(id, 'id');
    const existing = await this.getExpenseForMutation(expenseId);

    if (existing.status !== 'unpaid') {
      throw new BadRequestException('Only unpaid expenses can be marked paid');
    }

    const actualPaidAmount = normalizeMoneyAmount(
      dto.actualPaidAmount ?? existing.expected_amount,
      'actualPaidAmount',
    );
    const paidAt = parseOptionalDateTime(dto.paidAt, 'paidAt');
    const paymentMethod = normalizeOptionalTrimmed(dto.paymentMethod);
    const referenceNumber = normalizeOptionalTrimmed(dto.referenceNumber);
    const notes = normalizeOptionalTrimmed(dto.notes) ?? existing.notes;
    const receipt = this.normalizeReceipt(dto.receipt, user.id);

    await this.db
      .updateTable('finance.expenses')
      .set({
        actual_paid_amount: actualPaidAmount,
        paid_at: paidAt,
        status: 'paid',
        payment_method: paymentMethod,
        reference_number: referenceNumber,
        notes,
        ...receipt,
        updated_by_user_id: user.id,
        updated_at: new Date(),
      })
      .where('id', '=', expenseId)
      .execute();

    await this.activityHistoryService.write({
      actor: user,
      entityType: 'expense',
      entityId: expenseId,
      actionType: 'expense.paid',
      summary: 'Expense marked paid',
      metadata: {
        title: existing.title,
        actualPaidAmount,
        paidAt: paidAt.toISOString(),
        receiptAttached: Boolean(receipt),
      },
    });

    await this.notificationsService.resolveForExpense(expenseId);
    return this.findOne(expenseId);
  }

  async replaceReceipt(user: CurrentUser, id: string, dto: ExpenseReceiptDto) {
    const expenseId = requireTrimmed(id, 'id');
    const existing = await this.getExpenseForMutation(expenseId);

    if (existing.status !== 'paid') {
      throw new BadRequestException('Only paid expenses can have receipts');
    }

    const previousReceipt = existing.receipt_file_url;
    const receipt = this.normalizeReceipt(dto, user.id);

    await this.db
      .updateTable('finance.expenses')
      .set({
        ...receipt,
        updated_by_user_id: user.id,
        updated_at: new Date(),
      })
      .where('id', '=', expenseId)
      .execute();

    await this.deleteReceiptFile(previousReceipt);
    await this.activityHistoryService.write({
      actor: user,
      entityType: 'expense',
      entityId: expenseId,
      actionType: existing.receipt_file_url
        ? 'expense.receipt_replaced'
        : 'expense.receipt_uploaded',
      summary: existing.receipt_file_url
        ? 'Expense receipt replaced'
        : 'Expense receipt uploaded',
      metadata: {
        title: existing.title,
        receiptOriginalFilename: receipt.receipt_original_filename,
      },
    });

    return this.findOne(expenseId);
  }

  async removeReceipt(user: CurrentUser, id: string) {
    const expenseId = requireTrimmed(id, 'id');
    const existing = await this.getExpenseForMutation(expenseId);

    if (existing.status !== 'paid') {
      throw new BadRequestException('Only paid expenses can have receipts');
    }

    await this.db
      .updateTable('finance.expenses')
      .set({
        receipt_file_url: null,
        receipt_public_id: null,
        receipt_original_filename: null,
        receipt_mime_type: null,
        receipt_file_size: null,
        receipt_uploaded_at: null,
        receipt_uploaded_by_user_id: null,
        updated_by_user_id: user.id,
        updated_at: new Date(),
      })
      .where('id', '=', expenseId)
      .execute();

    await this.deleteReceiptFile(existing.receipt_file_url);
    await this.activityHistoryService.write({
      actor: user,
      entityType: 'expense',
      entityId: expenseId,
      actionType: 'expense.receipt_removed',
      summary: 'Expense receipt removed',
      metadata: {
        title: existing.title,
        receiptOriginalFilename: existing.receipt_original_filename,
      },
    });

    return this.findOne(expenseId);
  }

  async void(user: CurrentUser, id: string, dto: VoidExpenseDto) {
    const expenseId = requireTrimmed(id, 'id');
    const existing = await this.getExpenseForMutation(expenseId);

    if (existing.status !== 'unpaid') {
      throw new BadRequestException('Only unpaid expenses can be voided');
    }

    const reason = requireTrimmed(dto.reason, 'reason');
    const voidedAt = new Date();

    await this.db
      .updateTable('finance.expenses')
      .set({
        status: 'void',
        voided_at: voidedAt,
        void_reason: reason,
        updated_by_user_id: user.id,
        updated_at: voidedAt,
      })
      .where('id', '=', expenseId)
      .execute();

    await this.activityHistoryService.write({
      actor: user,
      entityType: 'expense',
      entityId: expenseId,
      actionType: 'expense.voided',
      summary: 'Expense voided',
      metadata: {
        title: existing.title,
        reason,
      },
    });

    await this.notificationsService.resolveForExpense(expenseId);
    return this.findOne(expenseId);
  }

  private async normalizeExpenseModel(
    input: CreateExpenseDto | UpdateExpenseDto,
    existing?: {
      title: string;
      category_id: string;
      expected_amount: string;
      expense_date: Date | null;
      due_date: Date;
      vendor_name: string | null;
      assigned_staff_id: string | null;
      notes: string | null;
    },
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
    const dueDate =
      input.dueDate !== undefined
        ? parseDateOnly(input.dueDate, 'dueDate')
        : existing?.due_date;

    if (!title) {
      throw new BadRequestException('title is required');
    }

    if (!categoryId) {
      throw new BadRequestException('categoryId is required');
    }

    if (!expectedAmount) {
      throw new BadRequestException('expectedAmount is required');
    }

    if (!dueDate) {
      throw new BadRequestException('dueDate is required');
    }

    await this.ensureActiveCategory(categoryId);

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
      expense_date:
        input.expenseDate !== undefined
          ? parseOptionalDateOnly(input.expenseDate, 'expenseDate')
          : (existing?.expense_date ?? null),
      due_date: dueDate,
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

  private async getExpenseForMutation(id: string) {
    const expense = await this.db
      .selectFrom('finance.expenses')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!expense) {
      throw new NotFoundException('Expense was not found');
    }

    return expense;
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

  private normalizeReceipt(
    receipt: ExpenseReceiptDto | null | undefined,
    userId: string,
  ): Partial<ExpenseReceiptModel> {
    if (!receipt) {
      return {};
    }

    const fileUrl = requireTrimmed(receipt.fileUrl, 'receipt.fileUrl');
    const fileSize =
      receipt.fileSize === undefined ||
      receipt.fileSize === null ||
      receipt.fileSize === ''
        ? null
        : parsePositiveInteger(receipt.fileSize, 0, 'receipt.fileSize', {
            min: 0,
            max: 50 * 1024 * 1024,
          });

    return {
      receipt_file_url: fileUrl,
      receipt_public_id: normalizeOptionalTrimmed(receipt.publicId),
      receipt_original_filename: normalizeOptionalTrimmed(
        receipt.originalFilename,
      ),
      receipt_mime_type: normalizeOptionalTrimmed(receipt.mimeType),
      receipt_file_size: fileSize,
      receipt_uploaded_at: new Date(),
      receipt_uploaded_by_user_id: userId,
    };
  }

  private async deleteReceiptFile(fileUrl: string | null) {
    if (!fileUrl) {
      return;
    }

    await this.expenseReceiptStorageService.deleteFiles([fileUrl]);
  }

  private baseExpenseQuery() {
    return this.db
      .selectFrom('finance.expenses')
      .innerJoin(
        'finance.expense_categories',
        'finance.expense_categories.id',
        'finance.expenses.category_id',
      )
      .leftJoin(
        'authentication.users as assigned_staff',
        'assigned_staff.id',
        'finance.expenses.assigned_staff_id',
      )
      .leftJoin(
        'finance.expense_recurring_rules',
        'finance.expense_recurring_rules.id',
        'finance.expenses.recurring_rule_id',
      )
      .select([
        'finance.expenses.id as id',
        'finance.expenses.recurring_rule_id as recurring_rule_id',
        'finance.expenses.billing_period_key as billing_period_key',
        'finance.expenses.title as title',
        'finance.expenses.category_id as category_id',
        'finance.expenses.expected_amount as expected_amount',
        'finance.expenses.actual_paid_amount as actual_paid_amount',
        'finance.expenses.expense_date as expense_date',
        'finance.expenses.due_date as due_date',
        'finance.expenses.paid_at as paid_at',
        'finance.expenses.status as status',
        'finance.expenses.vendor_name as vendor_name',
        'finance.expenses.assigned_staff_id as assigned_staff_id',
        'finance.expenses.payment_method as payment_method',
        'finance.expenses.reference_number as reference_number',
        'finance.expenses.notes as notes',
        'finance.expenses.voided_at as voided_at',
        'finance.expenses.void_reason as void_reason',
        'finance.expenses.receipt_file_url as receipt_file_url',
        'finance.expenses.receipt_public_id as receipt_public_id',
        'finance.expenses.receipt_original_filename as receipt_original_filename',
        'finance.expenses.receipt_mime_type as receipt_mime_type',
        'finance.expenses.receipt_file_size as receipt_file_size',
        'finance.expenses.receipt_uploaded_at as receipt_uploaded_at',
        'finance.expenses.receipt_uploaded_by_user_id as receipt_uploaded_by_user_id',
        'finance.expenses.created_by_user_id as created_by_user_id',
        'finance.expenses.updated_by_user_id as updated_by_user_id',
        'finance.expenses.created_at as created_at',
        'finance.expenses.updated_at as updated_at',
        'finance.expense_categories.name as category_name',
        'finance.expense_categories.description as category_description',
        'finance.expense_categories.is_default as category_is_default',
        'finance.expense_categories.is_active as category_is_active',
        'finance.expense_categories.created_at as category_created_at',
        'finance.expense_categories.updated_at as category_updated_at',
        'assigned_staff.full_name as assigned_staff_full_name',
        'assigned_staff.email as assigned_staff_email',
        'assigned_staff.active as assigned_staff_active',
        'finance.expense_recurring_rules.frequency as recurring_frequency',
      ]);
  }

  private baseExpenseCountQuery() {
    return this.db
      .selectFrom('finance.expenses')
      .innerJoin(
        'finance.expense_categories',
        'finance.expense_categories.id',
        'finance.expenses.category_id',
      )
      .leftJoin(
        'authentication.users as assigned_staff',
        'assigned_staff.id',
        'finance.expenses.assigned_staff_id',
      )
      .leftJoin(
        'finance.expense_recurring_rules',
        'finance.expense_recurring_rules.id',
        'finance.expenses.recurring_rule_id',
      )
      .select(({ fn }) => fn.count<string>('finance.expenses.id').as('total'));
  }

  private applyFilters<TQuery extends { where: (...args: any[]) => TQuery }>(
    query: TQuery,
    filters: ListExpensesQueryDto,
  ) {
    let nextQuery = query;
    const search = filters.search?.trim();

    if (search) {
      nextQuery = nextQuery.where((eb: any) =>
        eb.or([
          eb('finance.expenses.title', 'ilike', `%${search}%`),
          eb('finance.expenses.vendor_name', 'ilike', `%${search}%`),
          eb('finance.expense_categories.name', 'ilike', `%${search}%`),
        ]),
      );
    }

    if (filters.categoryId) {
      nextQuery = nextQuery.where(
        'finance.expenses.category_id',
        '=',
        filters.categoryId.trim(),
      );
    }

    if (filters.assignedStaffId) {
      nextQuery = nextQuery.where(
        'finance.expenses.assigned_staff_id',
        '=',
        filters.assignedStaffId.trim(),
      );
    }

    if (filters.frequency) {
      const frequency = parseExpenseFrequency(filters.frequency, 'one_time');
      if (frequency === 'one_time') {
        nextQuery = nextQuery.where(
          'finance.expenses.recurring_rule_id',
          'is',
          null,
        );
      } else {
        nextQuery = nextQuery.where(
          'finance.expense_recurring_rules.frequency',
          '=',
          frequency,
        );
      }
    }

    if (filters.startDate) {
      nextQuery = nextQuery.where(
        'finance.expenses.due_date',
        '>=',
        parseDateOnly(filters.startDate, 'startDate'),
      );
    }

    if (filters.endDate) {
      nextQuery = nextQuery.where(
        'finance.expenses.due_date',
        '<=',
        parseDateOnly(filters.endDate, 'endDate'),
      );
    }

    if (filters.status) {
      nextQuery = this.applyStatusFilter(
        nextQuery,
        parseExpenseDisplayStatus(filters.status),
      );
    }

    return nextQuery;
  }

  private applyStatusFilter<
    TQuery extends { where: (...args: any[]) => TQuery },
  >(query: TQuery, status: ReturnType<typeof parseExpenseDisplayStatus>) {
    const todayKey = formatDateKey(new Date());

    switch (status) {
      case 'paid':
      case 'void':
        return query.where('finance.expenses.status', '=', status);
      case 'unpaid':
        return query.where('finance.expenses.status', '=', 'unpaid');
      case 'overdue':
        return query
          .where('finance.expenses.status', '=', 'unpaid')
          .where('finance.expenses.due_date', '<', sql`${todayKey}::date`);
      case 'due_today':
        return query
          .where('finance.expenses.status', '=', 'unpaid')
          .where('finance.expenses.due_date', '=', sql`${todayKey}::date`);
      case 'due_soon':
        return query
          .where('finance.expenses.status', '=', 'unpaid')
          .where('finance.expenses.due_date', '>', sql`${todayKey}::date`)
          .where(
            'finance.expenses.due_date',
            '<=',
            sql`(${todayKey}::date + interval '7 days')::date`,
          );
      case 'upcoming':
        return query
          .where('finance.expenses.status', '=', 'unpaid')
          .where(
            'finance.expenses.due_date',
            '>',
            sql`(${todayKey}::date + interval '7 days')::date`,
          );
      default:
        return query;
    }
  }

  private applySorting(
    query: ReturnType<ExpensesService['baseExpenseQuery']>,
    filters: ListExpensesQueryDto,
  ) {
    const direction = filters.sortOrder === 'desc' ? 'desc' : 'asc';

    switch (filters.sortBy) {
      case 'title':
        return query.orderBy('finance.expenses.title', direction);
      case 'amount':
        return query.orderBy('finance.expenses.expected_amount', direction);
      case 'createdAt':
        return query.orderBy('finance.expenses.created_at', direction);
      case 'dueDate':
        return query.orderBy('finance.expenses.due_date', direction);
      default: {
        const todayKey = formatDateKey(new Date());
        return query
          .orderBy(
            sql`
              case
                when finance.expenses.status = 'unpaid'
                  and finance.expenses.due_date < ${todayKey}::date then 0
                when finance.expenses.status = 'unpaid'
                  and finance.expenses.due_date = ${todayKey}::date then 1
                when finance.expenses.status = 'unpaid'
                  and finance.expenses.due_date <= (${todayKey}::date + interval '7 days')::date then 2
                when finance.expenses.status = 'unpaid' then 3
                when finance.expenses.status = 'paid' then 4
                else 5
              end
            `,
            'asc',
          )
          .orderBy('finance.expenses.due_date', 'asc')
          .orderBy('finance.expenses.created_at', 'desc');
      }
    }
  }

  private mapExpense(row: ExpenseJoinedRow): ExpenseResponse {
    return {
      id: row.id,
      recurringRuleId: row.recurring_rule_id,
      billingPeriodKey: row.billing_period_key,
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
      actualPaidAmount: row.actual_paid_amount,
      expenseDate: row.expense_date,
      dueDate: row.due_date,
      paidAt: row.paid_at,
      status: parseExpenseSettlementStatus(row.status),
      displayStatus: resolveExpenseDisplayStatus(row),
      frequency:
        row.recurring_rule_id && row.recurring_frequency
          ? parseExpenseFrequency(row.recurring_frequency, 'monthly')
          : 'one_time',
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
      paymentMethod: row.payment_method,
      referenceNumber: row.reference_number,
      notes: row.notes,
      voidedAt: row.voided_at,
      voidReason: row.void_reason,
      receipt: row.receipt_file_url
        ? {
            fileUrl: row.receipt_file_url,
            publicId: row.receipt_public_id,
            originalFilename: row.receipt_original_filename,
            mimeType: row.receipt_mime_type,
            fileSize: row.receipt_file_size,
            uploadedAt: row.receipt_uploaded_at,
            uploadedByUserId: row.receipt_uploaded_by_user_id,
          }
        : null,
      createdByUserId: row.created_by_user_id,
      updatedByUserId: row.updated_by_user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
