export class CreateSaleDto {
  vehicleId!: string;
  buyerLeadId!: string;
  saleDate!: string;
  finalSaleAmount!: string;
  agentName?: string | null;
  commissionOverrideAmount?: string | null;
  commissionOverrideReason?: string | null;
  buyerClosingNote?: string | null;
}
