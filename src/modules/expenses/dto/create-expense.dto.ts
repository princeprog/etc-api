export class CreateExpenseDto {
  title?: string;
  categoryId?: string;
  expectedAmount?: string;
  expenseDate?: string | null;
  dueDate?: string;
  frequency?: string;
  vendorName?: string | null;
  assignedStaffId?: string | null;
  notes?: string | null;
}
