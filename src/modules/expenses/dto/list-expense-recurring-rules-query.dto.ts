export class ListExpenseRecurringRulesQueryDto {
  search?: string;
  categoryId?: string;
  frequency?: string;
  assignedStaffId?: string;
  includeInactive?: string | boolean;
}
