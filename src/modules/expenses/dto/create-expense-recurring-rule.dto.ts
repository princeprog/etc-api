export class CreateExpenseRecurringRuleDto {
  title?: string;
  categoryId?: string;
  expectedAmount?: string;
  frequency?: string;
  dueDay?: number | string;
  startDate?: string;
  endDate?: string | null;
  vendorName?: string | null;
  assignedStaffId?: string | null;
  notes?: string | null;
}
