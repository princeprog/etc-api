import type {
  ExpenseDisplayStatus,
  ExpenseFrequency,
  ExpenseRuleFrequency,
  ExpenseSettlementStatus,
} from '../../database/schema';

export interface ExpenseCategoryResponse {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpenseStaffSummary {
  id: string;
  fullName: string;
  email: string;
  active: boolean;
}

export interface ExpenseReceiptResponse {
  fileUrl: string;
  publicId: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  fileSize: number | null;
  uploadedAt: Date | null;
  uploadedByUserId: string | null;
}

export interface ExpenseResponse {
  id: string;
  recurringRuleId: string | null;
  billingPeriodKey: string | null;
  title: string;
  categoryId: string;
  category: ExpenseCategoryResponse;
  expectedAmount: string;
  actualPaidAmount: string | null;
  expenseDate: Date | null;
  dueDate: Date;
  paidAt: Date | null;
  status: ExpenseSettlementStatus;
  displayStatus: ExpenseDisplayStatus;
  frequency: ExpenseFrequency;
  vendorName: string | null;
  assignedStaffId: string | null;
  assignedStaff: ExpenseStaffSummary | null;
  paymentMethod: string | null;
  referenceNumber: string | null;
  notes: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  receipt: ExpenseReceiptResponse | null;
  createdByUserId: string;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpenseRecurringRuleResponse {
  id: string;
  title: string;
  categoryId: string;
  category: ExpenseCategoryResponse;
  expectedAmount: string;
  frequency: ExpenseRuleFrequency;
  dueDay: number;
  startDate: Date;
  endDate: Date | null;
  vendorName: string | null;
  assignedStaffId: string | null;
  assignedStaff: ExpenseStaffSummary | null;
  notes: string | null;
  isActive: boolean;
  createdByUserId: string;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpenseListResponse {
  expenses: ExpenseResponse[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
