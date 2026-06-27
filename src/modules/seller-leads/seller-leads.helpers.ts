import { BadRequestException } from '@nestjs/common';

import type {
  InspectionItemRating,
  SellerLeadDecision,
  SellerLeadInspectionFindings,
  SellerLeadStatus,
  VehicleTrackedCostCategory,
} from '../../database/schema';
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

const SELLER_LEAD_ESTIMATED_COST_CATEGORIES: VehicleTrackedCostCategory[] = [
  'reconditioning',
  'repair',
  'detailing',
  'transport',
  'documentation',
  'miscellaneous',
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
  value: SellerLeadInspectionFindings | null | undefined,
): SellerLeadInspectionFindings | null {
  if (!value) {
    return null;
  }

  const normalizedEntries = Object.entries(value).map(([key, finding]) => {
    if (!finding) {
      return [key, undefined] as const;
    }

    if (!INSPECTION_ITEM_RATINGS.includes(finding.rating)) {
      throw new BadRequestException(
        `Unsupported inspection rating for ${key}: ${finding.rating}`,
      );
    }

    return [
      key,
      {
        rating: finding.rating,
        notes: finding.notes?.trim() ? finding.notes.trim() : null,
      },
    ] as const;
  });

  return Object.fromEntries(
    normalizedEntries.filter(([, finding]) => finding !== undefined),
  ) as SellerLeadInspectionFindings;
}

export function parseSellerLeadEstimatedCostCategory(
  value: string | undefined,
  fallback?: VehicleTrackedCostCategory,
): VehicleTrackedCostCategory {
  if (!value) {
    if (fallback) {
      return fallback;
    }

    throw new BadRequestException('Estimated cost category is required');
  }

  if (
    !SELLER_LEAD_ESTIMATED_COST_CATEGORIES.includes(
      value as VehicleTrackedCostCategory,
    )
  ) {
    throw new BadRequestException(
      `Unsupported estimated cost category: ${value}`,
    );
  }

  return value as VehicleTrackedCostCategory;
}

export function normalizeSellerLeadEstimatedCostAmount(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new BadRequestException('Estimated cost amount is required');
  }

  return centsToMoney(parseMoneyToCents(trimmed, 'estimatedCost.amount'));
}

export function normalizeSellerLeadEstimatedCostNote(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new BadRequestException('Estimated cost note is required');
  }

  return trimmed;
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

export function calculateSellerLeadEvaluationSummary(input: {
  askingPrice: string | null;
  targetBuyPrice: string | null;
  expectedResalePrice: string | null;
  targetProfitAmount: string | null;
  estimatedCosts: Array<{ amount: string }>;
}) {
  const basePrice = input.targetBuyPrice ?? input.askingPrice;
  const estimatedCostsTotalCents = input.estimatedCosts.reduce(
    (sum, cost) => sum + parseMoneyToCents(cost.amount, 'estimatedCost.amount'),
    0,
  );
  const estimatedCostsTotal = centsToMoney(estimatedCostsTotalCents);

  const estimatedTotalInvestment =
    basePrice === null
      ? null
      : centsToMoney(
          parseMoneyToCents(basePrice, 'sellerLead.targetBuyPrice') +
            estimatedCostsTotalCents,
        );

  const estimatedGrossProfit =
    input.expectedResalePrice && estimatedTotalInvestment
      ? centsToMoney(
          parseMoneyToCents(
            input.expectedResalePrice,
            'sellerLead.expectedResalePrice',
          ) - parseMoneyToCents(estimatedTotalInvestment, 'summary.investment'),
        )
      : null;

  const estimatedProfitMargin =
    input.expectedResalePrice && estimatedGrossProfit
      ? (
          (parseMoneyToCents(estimatedGrossProfit, 'summary.grossProfit') /
            parseMoneyToCents(
              input.expectedResalePrice,
              'sellerLead.expectedResalePrice',
            )) *
          100
        ).toFixed(2)
      : null;

  let recommendedAction: SellerLeadDecision | null = null;
  if (estimatedGrossProfit && input.targetProfitAmount) {
    recommendedAction =
      parseMoneyToCents(estimatedGrossProfit, 'summary.grossProfit') >=
      parseMoneyToCents(input.targetProfitAmount, 'sellerLead.targetProfitAmount')
        ? 'Buy'
        : 'Negotiate';
  } else if (estimatedGrossProfit) {
    recommendedAction =
      parseMoneyToCents(estimatedGrossProfit, 'summary.grossProfit') > 0
        ? 'Buy'
        : 'Walk Away';
  }

  return {
    estimatedCostsTotal,
    estimatedTotalInvestment,
    estimatedGrossProfit,
    estimatedProfitMargin,
    recommendedAction,
  };
}

export function mapSellerLeadEstimatedCostResponse(cost: {
  id: string;
  category: VehicleTrackedCostCategory;
  amount: string;
  note: string;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: cost.id,
    category: cost.category,
    amount: cost.amount,
    note: cost.note,
    createdAt: cost.created_at,
    updatedAt: cost.updated_at,
  };
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
  inspection_findings: SellerLeadInspectionFindings | null;
  target_buy_price: string | null;
  expected_resale_price: string | null;
  target_profit_amount: string | null;
  decision: SellerLeadDecision | null;
  decision_note: string | null;
  approved_to_buy_at: Date | null;
  approved_by_user_id: string | null;
  status: SellerLeadStatus;
  assignee_user_id: string | null;
  latest_activity_at: Date | null;
  closing_note: string | null;
  created_at: Date;
  updated_at: Date;
  estimatedCosts?: ReturnType<typeof mapSellerLeadEstimatedCostResponse>[];
  estimatedCostsTotal?: string;
  estimatedTotalInvestment?: string | null;
  estimatedGrossProfit?: string | null;
  estimatedProfitMargin?: string | null;
  recommendedAction?: SellerLeadDecision | null;
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
    inspectionFindings: lead.inspection_findings,
    targetBuyPrice: lead.target_buy_price,
    expectedResalePrice: lead.expected_resale_price,
    targetProfitAmount: lead.target_profit_amount,
    decision: lead.decision,
    decisionNote: lead.decision_note,
    approvedToBuyAt: lead.approved_to_buy_at,
    approvedByUserId: lead.approved_by_user_id,
    status: lead.status,
    assigneeUserId: lead.assignee_user_id,
    latestActivityAt: lead.latest_activity_at,
    closingNote: lead.closing_note,
    estimatedCosts: lead.estimatedCosts ?? [],
    estimatedCostsTotal: lead.estimatedCostsTotal ?? '0.00',
    estimatedTotalInvestment: lead.estimatedTotalInvestment ?? null,
    estimatedGrossProfit: lead.estimatedGrossProfit ?? null,
    estimatedProfitMargin: lead.estimatedProfitMargin ?? null,
    recommendedAction: lead.recommendedAction ?? null,
    createdAt: lead.created_at,
    updatedAt: lead.updated_at,
  };
}
