import type {
  VehicleQualityGrade,
  VehicleQualityInput,
  VehicleQualityIssue,
  VehicleQualityScore,
} from './vehicle-quality.types';

const STALE_INVENTORY_WARNING_DAYS = 60;
const STALE_INVENTORY_CRITICAL_DAYS = 90;
const RECOMMENDED_PHOTO_COUNT = 3;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const GRADE_THRESHOLDS: Array<{ min: number; grade: VehicleQualityGrade }> = [
  { min: 90, grade: 'excellent' },
  { min: 75, grade: 'good' },
  { min: 50, grade: 'needs_attention' },
  { min: 0, grade: 'incomplete' },
];

/**
 * Each dimension carries a weight; checks within a dimension share that weight
 * proportionally. Keeping weights centralized makes future tuning explicit.
 */
const DIMENSION_WEIGHTS = {
  coreInfo: 25,
  commercial: 30,
  media: 15,
  profitability: 10,
  freshness: 10,
  statusConsistency: 10,
} as const;

interface QualityCheckOutcome {
  weight: number;
  passed: boolean;
  applicable: boolean;
  issue?: VehicleQualityIssue;
}

function isMoneyPositive(value: string | null): boolean {
  if (value === null || value === undefined) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0;
}

function moneyValueOrNull(value: string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function gradeForScore(score: number): VehicleQualityGrade {
  for (const tier of GRADE_THRESHOLDS) {
    if (score >= tier.min) return tier.grade;
  }
  return 'incomplete';
}

function evaluateCoreInfo(input: VehicleQualityInput): QualityCheckOutcome[] {
  const checks: Array<{
    field: string;
    passed: boolean;
    label: string;
    description: string;
    code: string;
  }> = [
    {
      field: 'brand',
      passed: Boolean(input.brand?.trim()),
      label: 'Add vehicle brand',
      description:
        'Brand is required for buyers and reports to identify the unit.',
      code: 'core.brand_missing',
    },
    {
      field: 'model',
      passed: Boolean(input.model?.trim()),
      label: 'Add vehicle model',
      description:
        'Model is required for buyers and reports to identify the unit.',
      code: 'core.model_missing',
    },
    {
      field: 'year',
      passed: Number.isInteger(input.year) && input.year > 1900,
      label: 'Add model year',
      description: 'A valid model year helps pricing and sales targeting.',
      code: 'core.year_missing',
    },
    {
      field: 'stockNumber',
      passed: Boolean(input.stockNumber?.trim()),
      label: 'Stock number missing',
      description:
        'Stock number identifies the unit in operations and reporting.',
      code: 'core.stock_number_missing',
    },
    {
      field: 'mileage',
      passed: typeof input.mileage === 'number' && input.mileage >= 0,
      label: 'Add vehicle mileage',
      description: 'Mileage impacts pricing and buyer expectations.',
      code: 'core.mileage_missing',
    },
  ];

  const optionalChecks: Array<{
    field: string;
    passed: boolean;
    label: string;
    description: string;
    code: string;
  }> = [
    {
      field: 'variant',
      passed: Boolean(input.variant?.trim()),
      label: 'Add vehicle variant',
      description: 'Variant clarifies trim/edition for buyers and pricing.',
      code: 'core.variant_missing',
    },
    {
      field: 'transmission',
      passed: Boolean(input.transmission?.trim()),
      label: 'Add transmission',
      description: 'Transmission is a common buyer filter.',
      code: 'core.transmission_missing',
    },
    {
      field: 'fuelType',
      passed: Boolean(input.fuelType?.trim()),
      label: 'Add fuel type',
      description: 'Fuel type is a common buyer filter.',
      code: 'core.fuel_type_missing',
    },
    {
      field: 'color',
      passed: Boolean(input.color?.trim()),
      label: 'Add vehicle color',
      description: 'Color is a frequent buyer question.',
      code: 'core.color_missing',
    },
  ];

  const requiredWeight = DIMENSION_WEIGHTS.coreInfo * 0.7;
  const optionalWeight = DIMENSION_WEIGHTS.coreInfo * 0.3;

  const requiredOutcomes: QualityCheckOutcome[] = checks.map((check) => ({
    weight: requiredWeight / checks.length,
    passed: check.passed,
    applicable: true,
    issue: check.passed
      ? undefined
      : {
          code: check.code,
          label: check.label,
          description: check.description,
          severity: 'critical',
          field: check.field,
        },
  }));

  const optionalOutcomes: QualityCheckOutcome[] = optionalChecks.map(
    (check) => ({
      weight: optionalWeight / optionalChecks.length,
      passed: check.passed,
      applicable: true,
      issue: check.passed
        ? undefined
        : {
            code: check.code,
            label: check.label,
            description: check.description,
            severity: 'info',
            field: check.field,
          },
    }),
  );

  return [...requiredOutcomes, ...optionalOutcomes];
}

function evaluateCommercial(input: VehicleQualityInput): QualityCheckOutcome[] {
  const purchasePresent = isMoneyPositive(input.purchasePrice);
  const targetPresent = isMoneyPositive(input.targetSellingPrice);
  const minimumPresent = isMoneyPositive(input.minimumAcceptablePrice);

  const purchase = moneyValueOrNull(input.purchasePrice);
  const target = moneyValueOrNull(input.targetSellingPrice);
  const minimum = moneyValueOrNull(input.minimumAcceptablePrice);

  const isSold = input.status === 'Sold';
  const isAvailable = input.status === 'Available';

  const targetMissingSeverity = isAvailable ? 'critical' : 'warning';
  const minimumMissingSeverity = isAvailable ? 'critical' : 'warning';

  const baseChecks: QualityCheckOutcome[] = [
    {
      weight: DIMENSION_WEIGHTS.commercial * 0.3,
      passed: purchasePresent,
      applicable: true,
      issue: purchasePresent
        ? undefined
        : {
            code: 'commercial.purchase_price_missing',
            label: 'Add purchase price',
            description:
              'Purchase price drives profitability tracking and reporting.',
            severity: 'warning',
            field: 'purchasePrice',
          },
    },
    {
      weight: DIMENSION_WEIGHTS.commercial * 0.3,
      passed: targetPresent,
      applicable: !isSold,
      issue: targetPresent
        ? undefined
        : {
            code: 'commercial.target_price_missing',
            label: 'Add target selling price',
            description:
              'Target selling price is required for sales readiness and reporting.',
            severity: targetMissingSeverity,
            field: 'targetSellingPrice',
          },
    },
    {
      weight: DIMENSION_WEIGHTS.commercial * 0.25,
      passed: minimumPresent,
      applicable: !isSold,
      issue: minimumPresent
        ? undefined
        : {
            code: 'commercial.minimum_price_missing',
            label: 'Add minimum selling price',
            description:
              'Minimum acceptable price protects margin during negotiations.',
            severity: minimumMissingSeverity,
            field: 'minimumAcceptablePrice',
          },
    },
  ];

  const consistencyChecks: QualityCheckOutcome[] = [];

  if (purchase !== null && target !== null) {
    const passed = target >= purchase;
    consistencyChecks.push({
      weight: DIMENSION_WEIGHTS.commercial * 0.075,
      passed,
      applicable: true,
      issue: passed
        ? undefined
        : {
            code: 'commercial.target_below_purchase',
            label: 'Review pricing: target price is below purchase price',
            description:
              'Selling at the target price will not recover acquisition cost. Confirm this is intentional.',
            severity: 'warning',
            field: 'targetSellingPrice',
          },
    });
  }

  if (target !== null && minimum !== null) {
    const passed = minimum <= target;
    consistencyChecks.push({
      weight: DIMENSION_WEIGHTS.commercial * 0.075,
      passed,
      applicable: true,
      issue: passed
        ? undefined
        : {
            code: 'commercial.minimum_above_target',
            label: 'Review pricing: minimum price is higher than target price',
            description:
              'The floor price exceeds the target price. Update one to keep negotiation room intact.',
            severity: 'critical',
            field: 'minimumAcceptablePrice',
          },
    });
  }

  return [...baseChecks, ...consistencyChecks];
}

function evaluateMedia(input: VehicleQualityInput): QualityCheckOutcome[] {
  const photoCount = input.photos.length;
  const isSold = input.status === 'Sold';
  const isAvailable = input.status === 'Available';

  const noPhotos = photoCount === 0;
  const fewPhotos = photoCount > 0 && photoCount < RECOMMENDED_PHOTO_COUNT;

  return [
    {
      weight: DIMENSION_WEIGHTS.media * 0.6,
      passed: photoCount >= 1,
      applicable: !isSold,
      issue: noPhotos
        ? {
            code: 'media.no_photos',
            label: 'Upload at least one vehicle photo',
            description:
              'A primary photo is required before this vehicle is sales-ready.',
            severity: isAvailable ? 'critical' : 'warning',
            field: 'photos',
          }
        : undefined,
    },
    {
      weight: DIMENSION_WEIGHTS.media * 0.4,
      passed: photoCount >= RECOMMENDED_PHOTO_COUNT,
      applicable: !isSold,
      issue: fewPhotos
        ? {
            code: 'media.few_photos',
            label: `Upload at least ${RECOMMENDED_PHOTO_COUNT} vehicle photos`,
            description:
              'Listings with multiple angles convert better. Aim for 3+ photos.',
            severity: 'info',
            field: 'photos',
          }
        : undefined,
    },
  ];
}

function evaluateProfitability(
  input: VehicleQualityInput,
): QualityCheckOutcome[] {
  const purchasePresent = isMoneyPositive(input.purchasePrice);
  const hasCostEntries = input.trackedCosts.length > 0;
  const isSold = input.status === 'Sold';

  const outcomes: QualityCheckOutcome[] = [
    {
      weight: DIMENSION_WEIGHTS.profitability * 0.6,
      passed: purchasePresent,
      applicable: true,
      issue: purchasePresent
        ? undefined
        : {
            code: 'profitability.purchase_price_missing',
            label: 'Add purchase price for accurate profitability',
            description:
              'Without a purchase price, profitability and ROI reports cannot be calculated.',
            severity: 'warning',
            field: 'purchasePrice',
          },
    },
    {
      weight: DIMENSION_WEIGHTS.profitability * 0.4,
      passed: hasCostEntries,
      applicable: !isSold,
      issue: hasCostEntries
        ? undefined
        : {
            code: 'profitability.no_tracked_costs',
            label: 'No tracked costs recorded',
            description:
              'If reconditioning, transport, or documentation costs apply, log them so profitability stays accurate. Skip if none apply.',
            severity: 'info',
            field: 'trackedCosts',
          },
    },
  ];

  return outcomes;
}

function evaluateFreshness(
  input: VehicleQualityInput,
  now: Date,
): QualityCheckOutcome[] {
  const isActiveInventory =
    input.status === 'Available' || input.status === 'Reconditioning';

  if (!isActiveInventory) {
    return [
      {
        weight: DIMENSION_WEIGHTS.freshness,
        passed: true,
        applicable: false,
      },
    ];
  }

  const ageDays = Math.max(
    0,
    Math.floor((now.getTime() - input.createdAt.getTime()) / DAY_IN_MS),
  );

  if (ageDays >= STALE_INVENTORY_CRITICAL_DAYS) {
    return [
      {
        weight: DIMENSION_WEIGHTS.freshness,
        passed: false,
        applicable: true,
        issue: {
          code: 'freshness.stale_critical',
          label: `Vehicle has been in inventory for ${ageDays} days`,
          description:
            'Inventory older than 90 days typically needs a pricing review or status update.',
          severity: 'warning',
          field: 'createdAt',
        },
      },
    ];
  }

  if (ageDays >= STALE_INVENTORY_WARNING_DAYS) {
    return [
      {
        weight: DIMENSION_WEIGHTS.freshness,
        passed: false,
        applicable: true,
        issue: {
          code: 'freshness.stale_warning',
          label: `Vehicle has been in inventory for ${ageDays} days`,
          description:
            'Consider reviewing pricing or merchandising for vehicles older than 60 days.',
          severity: 'info',
          field: 'createdAt',
        },
      },
    ];
  }

  return [
    {
      weight: DIMENSION_WEIGHTS.freshness,
      passed: true,
      applicable: true,
    },
  ];
}

function evaluateStatusConsistency(
  input: VehicleQualityInput,
): QualityCheckOutcome[] {
  const outcomes: QualityCheckOutcome[] = [];

  if (input.status === 'Available') {
    const targetPresent = isMoneyPositive(input.targetSellingPrice);
    const minimumPresent = isMoneyPositive(input.minimumAcceptablePrice);
    const hasPhoto = input.photos.length >= 1;

    const passed = targetPresent && minimumPresent && hasPhoto;

    outcomes.push({
      weight: DIMENSION_WEIGHTS.statusConsistency,
      passed,
      applicable: true,
      issue: passed
        ? undefined
        : {
            code: 'status.available_not_sales_ready',
            label: 'Available vehicle is missing sales-ready data',
            description:
              'Available units should have target price, minimum price, and at least one photo.',
            severity: 'critical',
            field: 'status',
          },
    });
  } else if (input.status === 'Reserved') {
    const passed = Boolean(input.sellerLeadId);
    outcomes.push({
      weight: DIMENSION_WEIGHTS.statusConsistency,
      passed: true,
      applicable: true,
      issue: passed
        ? undefined
        : {
            code: 'status.reserved_without_link',
            label: 'Reserved vehicle has no linked seller lead',
            description:
              'Reserved units should reference a lead or reservation source for traceability.',
            severity: 'info',
            field: 'sellerLeadId',
          },
    });
  } else {
    outcomes.push({
      weight: DIMENSION_WEIGHTS.statusConsistency,
      passed: true,
      applicable: true,
    });
  }

  return outcomes;
}

function uniqueIssuesByCode(
  issues: VehicleQualityIssue[],
): VehicleQualityIssue[] {
  const seen = new Set<string>();
  const result: VehicleQualityIssue[] = [];
  for (const issue of issues) {
    if (seen.has(issue.code)) continue;
    seen.add(issue.code);
    result.push(issue);
  }
  return result;
}

/**
 * Centralized scoring entry point. Pure function — relies only on the supplied
 * input and the provided `now` value so it is deterministic and unit testable.
 */
export function evaluateVehicleQuality(
  input: VehicleQualityInput,
  now: Date = new Date(),
): VehicleQualityScore {
  const outcomes: QualityCheckOutcome[] = [
    ...evaluateCoreInfo(input),
    ...evaluateCommercial(input),
    ...evaluateMedia(input),
    ...evaluateProfitability(input),
    ...evaluateFreshness(input, now),
    ...evaluateStatusConsistency(input),
  ];

  const applicable = outcomes.filter((outcome) => outcome.applicable);

  const totalWeight = applicable.reduce(
    (sum, outcome) => sum + outcome.weight,
    0,
  );
  const earnedWeight = applicable.reduce(
    (sum, outcome) => sum + (outcome.passed ? outcome.weight : 0),
    0,
  );

  const rawScore =
    totalWeight === 0 ? 100 : Math.round((earnedWeight / totalWeight) * 100);
  const score = Math.max(0, Math.min(100, rawScore));

  const issues = uniqueIssuesByCode(
    outcomes
      .filter((outcome) => outcome.applicable)
      .map((outcome) => outcome.issue)
      .filter((issue): issue is VehicleQualityIssue => Boolean(issue)),
  );

  return {
    score,
    grade: gradeForScore(score),
    blockingIssues: issues.filter((issue) => issue.severity === 'critical'),
    warnings: issues.filter((issue) => issue.severity === 'warning'),
    suggestions: issues.filter((issue) => issue.severity === 'info'),
    lastEvaluatedAt: now.toISOString(),
  };
}
