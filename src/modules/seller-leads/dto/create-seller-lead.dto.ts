import type {
  SellerLeadDecision,
  SellerLeadInspectionFindings,
  SellerLeadStatus,
} from '../../../database/schema';

export class CreateSellerLeadDto {
  sellerName!: string;
  contactNumber!: string;
  email?: string | null;
  facebookName?: string | null;
  inquirySource?: string | null;
  vehicleBrand!: string;
  vehicleModel!: string;
  vehicleYear?: number | null;
  vehicleVariant?: string | null;
  askingPrice?: string | null;
  region?: string | null;
  notes?: string | null;
  inspectionCompletedAt?: string | null;
  inspectionNotes?: string | null;
  inspectionFindings?: SellerLeadInspectionFindings | null;
  targetBuyPrice?: string | null;
  expectedResalePrice?: string | null;
  targetProfitAmount?: string | null;
  decision?: SellerLeadDecision | null;
  decisionNote?: string | null;
  status?: SellerLeadStatus;
  assigneeUserId?: string | null;
  closingNote?: string | null;
}
