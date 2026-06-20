import { BadRequestException } from '@nestjs/common';

import type { SellerLeadStatus } from '../../database/schema';

const SELLER_LEAD_STATUSES: SellerLeadStatus[] = [
  'New Inquiry',
  'Contacted',
  'Inspection Scheduled',
  'Negotiating',
  'Purchased',
  'Rejected',
];

export function parseSellerLeadStatus(
  value: string | undefined,
  fallback: SellerLeadStatus,
): SellerLeadStatus {
  if (!value) {
    return fallback;
  }

  if (!SELLER_LEAD_STATUSES.includes(value as SellerLeadStatus)) {
    throw new BadRequestException(`Unsupported seller lead status: ${value}`);
  }

  return value as SellerLeadStatus;
}

export function mapSellerLeadResponse(lead: {
  id: string;
  seller_name: string;
  contact_number: string;
  email: string | null;
  facebook_name: string | null;
  inquiry_source: string | null;
  vehicle_brand: string;
  vehicle_model: string;
  vehicle_year: number | null;
  vehicle_variant: string | null;
  asking_price: string | null;
  region: string | null;
  notes: string | null;
  status: SellerLeadStatus;
  assignee_user_id: string | null;
  latest_activity_at: Date | null;
  closing_note: string | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: lead.id,
    sellerName: lead.seller_name,
    contactNumber: lead.contact_number,
    email: lead.email,
    facebookName: lead.facebook_name,
    inquirySource: lead.inquiry_source,
    vehicleBrand: lead.vehicle_brand,
    vehicleModel: lead.vehicle_model,
    vehicleYear: lead.vehicle_year,
    vehicleVariant: lead.vehicle_variant,
    askingPrice: lead.asking_price,
    region: lead.region,
    notes: lead.notes,
    status: lead.status,
    assigneeUserId: lead.assignee_user_id,
    latestActivityAt: lead.latest_activity_at,
    closingNote: lead.closing_note,
    createdAt: lead.created_at,
    updatedAt: lead.updated_at,
  };
}
