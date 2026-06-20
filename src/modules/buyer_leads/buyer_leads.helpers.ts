import { BadRequestException } from '@nestjs/common';

import type { BuyerLeadStatus } from '../../database/schema';

const BUYER_LEAD_STATUSES: BuyerLeadStatus[] = [
  'New Inquiry',
  'Contacted',
  'Interested',
  'Negotiating',
  'Reserved',
  'Won',
  'Lost',
];

export function parseBuyerLeadStatus(
  value: string | undefined,
  fallback: BuyerLeadStatus,
): BuyerLeadStatus {
  if (!value) {
    return fallback;
  }

  if (!BUYER_LEAD_STATUSES.includes(value as BuyerLeadStatus)) {
    throw new BadRequestException(`Unsupported buyer lead status: ${value}`);
  }

  return value as BuyerLeadStatus;
}

export function mapBuyerLeadResponse(lead: {
  id: string;
  buyer_name: string;
  contact_number: string;
  email: string | null;
  facebook_name: string | null;
  inquiry_source: string | null;
  desired_budget: string | null;
  notes: string | null;
  status: BuyerLeadStatus;
  assignee_user_id: string | null;
  latest_activity_at: Date | null;
  closing_note: string | null;
  created_at: Date;
  updated_at: Date;
  vehicles: Array<{
    id: string;
    stockNumber: string;
    brand: string;
    model: string;
    year: number;
    status: string;
  }>;
}) {
  return {
    id: lead.id,
    buyerName: lead.buyer_name,
    contactNumber: lead.contact_number,
    email: lead.email,
    facebookName: lead.facebook_name,
    inquirySource: lead.inquiry_source,
    desiredBudget: lead.desired_budget,
    notes: lead.notes,
    status: lead.status,
    assigneeUserId: lead.assignee_user_id,
    latestActivityAt: lead.latest_activity_at,
    closingNote: lead.closing_note,
    createdAt: lead.created_at,
    updatedAt: lead.updated_at,
    vehicles: lead.vehicles,
  };
}
