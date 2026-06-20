import type { BuyerLeadStatus } from '../../../database/schema';

export class UpdateBuyerLeadDto {
  buyerName?: string;
  contactNumber?: string;
  email?: string | null;
  facebookName?: string | null;
  inquirySource?: string | null;
  desiredBudget?: string | null;
  notes?: string | null;
  status?: BuyerLeadStatus;
  assigneeUserId?: string | null;
  closingNote?: string | null;
}
