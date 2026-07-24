import { BadRequestException } from '@nestjs/common';
import type { Json, JsonObject } from '../../database/db';

import type {
  InspectionItemRating,
  SellerLeadDecision,
  SellerLeadInspectionFindings,
  SellerLeadStatus,
} from '../../database/schema';
import type { LeadPipelineState } from '../lead-pipeline/lead-pipeline.types';
import { centsToMoney, parseMoneyToCents } from '../sales/sales.helpers';

const SELLER_LEAD_STATUSES: SellerLeadStatus[] = [
  'New Inquiry',
  'Contacted',
  'Inspection Scheduled',
  'Evaluated',
  'Negotiating',
  'Approved to Buy',
  'Purchased',
  'Rejected',
];

const SELLER_LEAD_DECISIONS: SellerLeadDecision[] = [
  'Buy',
  'Negotiate',
  'Walk Away',
];

const INSPECTION_ITEM_RATINGS: InspectionItemRating[] = [
  'excellent',
  'good',
  'fair',
  'poor',
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

export function parseSellerLeadDecision(
  value: string | undefined | null,
  fallback?: SellerLeadDecision | null,
): SellerLeadDecision | null {
  if (!value) {
    return fallback ?? null;
  }

  if (!SELLER_LEAD_DECISIONS.includes(value as SellerLeadDecision)) {
    throw new BadRequestException(`Unsupported seller lead decision: ${value}`);
  }

  return value as SellerLeadDecision;
}

export function parseInspectionFindings(
  value: Json | SellerLeadInspectionFindings | null | undefined,
): SellerLeadInspectionFindings | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return null;
  }

  const normalizedEntries = Object.entries(value as Record<string, unknown>).map(
    ([key, rawFinding]) => {
      if (!rawFinding || typeof rawFinding !== 'object' || Array.isArray(rawFinding)) {
        return [key, undefined] as const;
      }

      const finding = rawFinding as { rating?: unknown; notes?: unknown };

      if (typeof finding.rating !== 'string') {
        return [key, undefined] as const;
      }

      if (!INSPECTION_ITEM_RATINGS.includes(finding.rating as InspectionItemRating)) {
        throw new BadRequestException(
          `Unsupported inspection rating for ${key}: ${String(finding.rating)}`,
        );
      }

      return [
        key,
        {
          rating: finding.rating as InspectionItemRating,
          notes:
            typeof finding.notes === 'string' && finding.notes.trim()
              ? finding.notes.trim()
              : null,
        },
      ] as const;
    },
  );

  return Object.fromEntries(
    normalizedEntries.filter(([, finding]) => finding !== undefined),
  ) as SellerLeadInspectionFindings;
}

export function serializeInspectionFindings(
  value: SellerLeadInspectionFindings | null | undefined,
): JsonObject | null {
  const normalized = parseInspectionFindings(value);

  if (!normalized) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(normalized).map(([key, finding]) => [
      key,
      {
        rating: finding.rating,
        notes: finding.notes,
      },
    ]),
  ) as JsonObject;
}

export function normalizeOptionalMoney(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? centsToMoney(parseMoneyToCents(trimmed, 'money')) : null;
}

export function parseOptionalIsoDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(
      'inspectionCompletedAt must be a valid ISO date',
    );
  }

  return parsed;
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
  inspection_completed_at: Date | null;
  inspection_notes: string | null;
  inspection_findings: Json | SellerLeadInspectionFindings | null;
  decision: SellerLeadDecision | null;
  decision_note: string | null;
  approved_to_buy_at: Date | null;
  approved_by_user_id: string | null;
  status: SellerLeadStatus;
  assignee_user_id: string | null;
  assignee?: {
    id: string;
    fullName: string;
    email: string;
    roleName: string;
  } | null;
  latest_activity_at: Date | null;
  closing_note: string | null;
  created_at: Date;
  updated_at: Date;
  pipeline?: LeadPipelineState | null;
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
    inspectionCompletedAt: lead.inspection_completed_at,
    inspectionNotes: lead.inspection_notes,
    inspectionFindings: parseInspectionFindings(lead.inspection_findings),
    decision: lead.decision,
    decisionNote: lead.decision_note,
    approvedToBuyAt: lead.approved_to_buy_at,
    approvedByUserId: lead.approved_by_user_id,
    status: lead.status,
    assigneeUserId: lead.assignee_user_id,
    assignee: lead.assignee ?? null,
    latestActivityAt: lead.latest_activity_at,
    closingNote: lead.closing_note,
    pipeline: lead.pipeline ?? null,
    createdAt: lead.created_at,
    updatedAt: lead.updated_at,
  };
}
