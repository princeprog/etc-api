export class UpdateExpenseDto {
  title?: string;
  categoryId?: string;
  expectedAmount?: string;
  expenseDate?: string | null;
  dueDate?: string;
  vendorName?: string | null;
  assignedStaffId?: string | null;
  notes?: string | null;
}
