export class MarkExpensePaidDto {
  actualPaidAmount?: string;
  paidAt?: string;
  paymentMethod?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
}
