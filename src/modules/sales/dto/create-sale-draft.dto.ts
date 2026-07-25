export class CreateSaleDraftDto {
  vehicleId!: string;
  buyerLeadId!: string;
  saleDate?: string | null;
  finalSaleAmount?: string | null;
  agentName?: string | null;
  commissionOverrideAmount?: string | null;
  commissionOverrideReason?: string | null;
  buyerClosingNote?: string | null;
  paymentMode?: 'cash' | 'financing' | null;
  financingApplicationId?: string | null;
}
