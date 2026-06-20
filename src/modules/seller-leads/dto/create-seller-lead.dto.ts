import type { SellerLeadStatus } from '../../../database/schema';

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
  status?: SellerLeadStatus;
  assigneeUserId?: string | null;
  closingNote?: string | null;
}
