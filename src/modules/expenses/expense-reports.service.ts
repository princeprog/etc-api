import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';

import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import {
  centsToMoney,
  formatDateKey,
  getTodayDateKey,
  moneyToCents,
  parseDateOnly,
  parseExpenseDisplayStatus,
  resolveExpenseDisplayStatus,
} from './expenses.helpers';
import type { ExpenseReportQueryDto } from './dto/expense-report-query.dto';
import { buildCsv, buildExportFilename } from '../reports/reports.helpers';

type ExpenseReportRow = {
  id: string;
  title: string;
  expected_amount: string;
  actual_paid_amount: string | null;
  due_date: Date;
  paid_at: Date | null;
  status: string;
  vendor_name: string | null;
  payment_method: string | null;
  category_id: string;
  category_name: string;
  assigned_staff_id: string | null;
  assigned_staff_full_name: string | null;
};

@Injectable()
export class ExpenseReportsService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async getDashboardSummary() {
    const todayKey = getTodayDateKey();
    const { startDate, endDate } = this.getMonthDateKeys(todayKey);
    const rows = await this.listExpenseRows({
      startDate,
      endDate,
    });

    return this.buildSummary(rows, todayKey);
  }

  async getMonthlyReport(query: ExpenseReportQueryDto) {
    const rows = await this.listExpenseRows(query);
    const todayKey = getTodayDateKey();

    return {
      filters: this.describeFilters(query),
      summary: this.buildSummary(rows, todayKey),
      byCategory: this.groupByCategory(rows),
      paidVsUnpaid: this.groupBySettlement(rows),
      overdue: rows
        .filter((row) => resolveExpenseDisplayStatus(row) === 'overdue')
        .map(mapReportExpense),
      monthlyTrend: this.groupByMonth(rows),
    };
  }

  async exportReport(query: ExpenseReportQueryDto) {
    const dataset = query.dataset ?? 'by-category';
    const report = await this.getMonthlyReport(query);

    if (dataset === 'by-category') {
      return {
        filename: buildExportFilename('expenses', 'by-category'),
        csv: buildCsv(
          [
            { header: 'Category', value: (row) => row.categoryName },
            { header: 'Bills', value: (row) => row.count },
            { header: 'Expected Amount', value: (row) => row.expectedAmount },
            { header: 'Paid Amount', value: (row) => row.paidAmount },
            { header: 'Unpaid Amount', value: (row) => row.unpaidAmount },
          ],
          report.byCategory,
        ),
      };
    }

    if (dataset === 'overdue') {
      return {
        filename: buildExportFilename('expenses', 'overdue'),
        csv: buildCsv(
          [
            { header: 'Title', value: (row) => row.title },
            { header: 'Category', value: (row) => row.categoryName },
            { header: 'Expected Amount', value: (row) => row.expectedAmount },
            { header: 'Due Date', value: (row) => row.dueDate },
            {
              header: 'Responsible Staff',
              value: (row) => row.assignedStaffName,
            },
          ],
          report.overdue,
        ),
      };
    }

    if (dataset === 'monthly-trend') {
      return {
        filename: buildExportFilename('expenses', 'monthly-trend'),
        csv: buildCsv(
          [
            { header: 'Month', value: (row) => row.month },
            { header: 'Bills', value: (row) => row.count },
            { header: 'Expected Amount', value: (row) => row.expectedAmount },
            { header: 'Paid Amount', value: (row) => row.paidAmount },
            { header: 'Unpaid Amount', value: (row) => row.unpaidAmount },
          ],
          report.monthlyTrend,
        ),
      };
    }

    throw new BadRequestException(
      'dataset must be by-category, overdue, or monthly-trend',
    );
  }

  private async listExpenseRows(query: ExpenseReportQueryDto) {
    const range = this.resolveDateRange(query);
    let rowsQuery = this.db
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
      .select([
        'finance.expenses.id as id',
        'finance.expenses.title as title',
        'finance.expenses.expected_amount as expected_amount',
        'finance.expenses.actual_paid_amount as actual_paid_amount',
        'finance.expenses.due_date as due_date',
        'finance.expenses.paid_at as paid_at',
        'finance.expenses.status as status',
        'finance.expenses.vendor_name as vendor_name',
        'finance.expenses.payment_method as payment_method',
        'finance.expenses.category_id as category_id',
        'finance.expense_categories.name as category_name',
        'finance.expenses.assigned_staff_id as assigned_staff_id',
        'assigned_staff.full_name as assigned_staff_full_name',
      ])
      .$if(Boolean(range.start), (qb) =>
        qb.where('finance.expenses.due_date', '>=', range.start as Date),
      )
      .$if(Boolean(range.end), (qb) =>
        qb.where('finance.expenses.due_date', '<=', range.end as Date),
      )
      .$if(Boolean(query.categoryId), (qb) =>
        qb.where(
          'finance.expenses.category_id',
          '=',
          query.categoryId?.trim() as string,
        ),
      )
      .$if(Boolean(query.paymentMethod), (qb) =>
        qb.where(
          sql`lower(coalesce(finance.expenses.payment_method, ''))`,
          '=',
          query.paymentMethod?.trim().toLowerCase() as string,
        ),
      )
      .$if(Boolean(query.vendorName), (qb) =>
        qb.where(
          'finance.expenses.vendor_name',
          'ilike',
          `%${query.vendorName?.trim()}%`,
        ),
      )
      .$if(Boolean(query.assignedStaffId), (qb) =>
        qb.where(
          'finance.expenses.assigned_staff_id',
          '=',
          query.assignedStaffId?.trim() as string,
        ),
      )
      .orderBy('finance.expenses.due_date', 'asc');

    const rows = await rowsQuery.execute();

    if (!query.status) {
      return rows;
    }

    const status = parseExpenseDisplayStatus(query.status);
    return rows.filter((row) => {
      if (status === 'unpaid') {
        return row.status === 'unpaid';
      }

      return resolveExpenseDisplayStatus(row) === status;
    });
  }

  private buildSummary(rows: ExpenseReportRow[], todayKey: string) {
    const financialRows = this.getFinancialRows(rows);
    const totalExpectedCents = financialRows.reduce(
      (sum, row) => sum + moneyToCents(row.expected_amount),
      0,
    );
    const paidRows = financialRows.filter((row) => row.status === 'paid');
    const unpaidRows = financialRows.filter((row) => row.status === 'unpaid');
    const overdueRows = financialRows.filter(
      (row) => resolveExpenseDisplayStatus(row) === 'overdue',
    );
    const dueSoonRows = financialRows.filter((row) => {
      const status = resolveExpenseDisplayStatus(row);
      return status === 'due_soon' || status === 'due_today';
    });
    const byCategory = this.groupByCategory(financialRows);

    return {
      totalExpenses: financialRows.length,
      totalExpectedAmount: centsToMoney(totalExpectedCents),
      paidAmount: centsToMoney(
        paidRows.reduce(
          (sum, row) =>
            sum + moneyToCents(row.actual_paid_amount ?? row.expected_amount),
          0,
        ),
      ),
      unpaidAmount: centsToMoney(
        unpaidRows.reduce(
          (sum, row) => sum + moneyToCents(row.expected_amount),
          0,
        ),
      ),
      overdueCount: overdueRows.length,
      overdueAmount: centsToMoney(
        overdueRows.reduce(
          (sum, row) => sum + moneyToCents(row.expected_amount),
          0,
        ),
      ),
      dueWithinSevenDaysCount: dueSoonRows.length,
      dueWithinSevenDaysAmount: centsToMoney(
        dueSoonRows.reduce(
          (sum, row) => sum + moneyToCents(row.expected_amount),
          0,
        ),
      ),
      highestSpendingCategory: byCategory[0] ?? null,
      asOfDate: todayKey,
    };
  }

  private groupByCategory(rows: ExpenseReportRow[]) {
    const financialRows = this.getFinancialRows(rows);
    const grouped = new Map<
      string,
      {
        categoryId: string;
        categoryName: string;
        count: number;
        expectedCents: number;
        paidCents: number;
        unpaidCents: number;
      }
    >();

    for (const row of financialRows) {
      const existing = grouped.get(row.category_id) ?? {
        categoryId: row.category_id,
        categoryName: row.category_name,
        count: 0,
        expectedCents: 0,
        paidCents: 0,
        unpaidCents: 0,
      };
      existing.count += 1;
      existing.expectedCents += moneyToCents(row.expected_amount);
      if (row.status === 'paid') {
        existing.paidCents += moneyToCents(
          row.actual_paid_amount ?? row.expected_amount,
        );
      }
      if (row.status === 'unpaid') {
        existing.unpaidCents += moneyToCents(row.expected_amount);
      }
      grouped.set(row.category_id, existing);
    }

    return Array.from(grouped.values())
      .map((item) => ({
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        count: item.count,
        expectedAmount: centsToMoney(item.expectedCents),
        paidAmount: centsToMoney(item.paidCents),
        unpaidAmount: centsToMoney(item.unpaidCents),
      }))
      .sort((a, b) => Number(b.expectedAmount) - Number(a.expectedAmount));
  }

  private groupBySettlement(rows: ExpenseReportRow[]) {
    const statuses = ['paid', 'unpaid', 'void'] as const;

    return statuses.map((status) => {
      const source = rows.filter((row) => row.status === status);
      const financialSource = status === 'void' ? [] : source;
      return {
        status,
        count: source.length,
        expectedAmount: centsToMoney(
          financialSource.reduce(
            (sum, row) => sum + moneyToCents(row.expected_amount),
            0,
          ),
        ),
        paidAmount: centsToMoney(
          financialSource.reduce(
            (sum, row) =>
              sum + moneyToCents(row.actual_paid_amount ?? row.expected_amount),
            0,
          ),
        ),
      };
    });
  }

  private groupByMonth(rows: ExpenseReportRow[]) {
    const financialRows = this.getFinancialRows(rows);
    const grouped = new Map<
      string,
      {
        count: number;
        expectedCents: number;
        paidCents: number;
        unpaidCents: number;
      }
    >();

    for (const row of financialRows) {
      const month = formatDateKey(row.due_date).slice(0, 7);
      const existing = grouped.get(month) ?? {
        count: 0,
        expectedCents: 0,
        paidCents: 0,
        unpaidCents: 0,
      };
      existing.count += 1;
      existing.expectedCents += moneyToCents(row.expected_amount);
      if (row.status === 'paid') {
        existing.paidCents += moneyToCents(
          row.actual_paid_amount ?? row.expected_amount,
        );
      }
      if (row.status === 'unpaid') {
        existing.unpaidCents += moneyToCents(row.expected_amount);
      }
      grouped.set(month, existing);
    }

    return Array.from(grouped.entries())
      .map(([month, item]) => ({
        month,
        count: item.count,
        expectedAmount: centsToMoney(item.expectedCents),
        paidAmount: centsToMoney(item.paidCents),
        unpaidAmount: centsToMoney(item.unpaidCents),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  private getFinancialRows(rows: ExpenseReportRow[]) {
    return rows.filter((row) => row.status !== 'void');
  }

  private resolveDateRange(query: ExpenseReportQueryDto) {
    const start = query.startDate
      ? parseDateOnly(query.startDate, 'startDate')
      : null;
    const end = query.endDate ? parseDateOnly(query.endDate, 'endDate') : null;

    if (start && end && start > end) {
      throw new BadRequestException('startDate must not be after endDate');
    }

    if (start || end) {
      return { start, end };
    }

    const { startDate, endDate } = this.getMonthDateKeys(getTodayDateKey());
    return {
      start: parseDateOnly(startDate, 'startDate'),
      end: parseDateOnly(endDate, 'endDate'),
    };
  }

  private getMonthDateKeys(dateKey: string) {
    const startDate = `${dateKey.slice(0, 7)}-01`;
    const start = parseDateOnly(startDate, 'startDate');
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);

    return {
      startDate,
      endDate: formatDateKey(end, 'UTC'),
    };
  }

  private describeFilters(query: ExpenseReportQueryDto) {
    const range = this.resolveDateRange(query);
    return {
      startDate: range.start ? formatDateKey(range.start, 'UTC') : null,
      endDate: range.end ? formatDateKey(range.end, 'UTC') : null,
      categoryId: query.categoryId ?? null,
      status: query.status ?? null,
      paymentMethod: query.paymentMethod ?? null,
      vendorName: query.vendorName ?? null,
      assignedStaffId: query.assignedStaffId ?? null,
    };
  }
}

function mapReportExpense(row: ExpenseReportRow) {
  return {
    id: row.id,
    title: row.title,
    categoryId: row.category_id,
    categoryName: row.category_name,
    expectedAmount: row.expected_amount,
    actualPaidAmount: row.actual_paid_amount,
    dueDate: formatDateKey(row.due_date),
    paidAt: row.paid_at,
    vendorName: row.vendor_name,
    paymentMethod: row.payment_method,
    assignedStaffId: row.assigned_staff_id,
    assignedStaffName: row.assigned_staff_full_name ?? 'Unassigned',
    status: row.status,
    displayStatus: resolveExpenseDisplayStatus(row),
  };
}
