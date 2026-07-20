import { ExpenseReportsService } from './expense-reports.service';

let rowIndex = 0;

function createReportRow(overrides: Partial<Record<string, unknown>> = {}) {
  rowIndex += 1;

  return {
    id: `expense-${rowIndex}`,
    title: 'Expense',
    expected_amount: '100.00',
    actual_paid_amount: null,
    due_date: new Date('2026-07-15T00:00:00.000Z'),
    paid_at: null,
    status: 'unpaid',
    vendor_name: null,
    payment_method: null,
    category_id: 'category-1',
    category_name: 'Operations',
    assigned_staff_id: null,
    assigned_staff_full_name: null,
    ...overrides,
  };
}

describe('ExpenseReportsService', () => {
  let service: ExpenseReportsService;

  beforeEach(() => {
    service = new ExpenseReportsService({} as never);
  });

  it('excludes void expenses from summary totals', () => {
    const summary = (service as any).buildSummary(
      [
        createReportRow({ expected_amount: '120.00', status: 'unpaid' }),
        createReportRow({
          expected_amount: '80.00',
          actual_paid_amount: '75.00',
          status: 'paid',
        }),
        createReportRow({ expected_amount: '500.00', status: 'void' }),
      ],
      '2026-07-20',
    );

    expect(summary.totalExpenses).toBe(2);
    expect(summary.totalExpectedAmount).toBe('200.00');
    expect(summary.paidAmount).toBe('75.00');
    expect(summary.unpaidAmount).toBe('120.00');
  });

  it('excludes void expenses from category and monthly expected totals', () => {
    const rows = [
      createReportRow({
        expected_amount: '120.00',
        category_id: 'category-1',
        category_name: 'Operations',
      }),
      createReportRow({
        expected_amount: '500.00',
        status: 'void',
        category_id: 'category-1',
        category_name: 'Operations',
      }),
    ];

    const byCategory = (service as any).groupByCategory(rows);
    const monthlyTrend = (service as any).groupByMonth(rows);

    expect(byCategory).toEqual([
      {
        categoryId: 'category-1',
        categoryName: 'Operations',
        count: 1,
        expectedAmount: '120.00',
        paidAmount: '0.00',
        unpaidAmount: '120.00',
      },
    ]);
    expect(monthlyTrend).toEqual([
      {
        month: '2026-07',
        count: 1,
        expectedAmount: '120.00',
        paidAmount: '0.00',
        unpaidAmount: '120.00',
      },
    ]);
  });
});
