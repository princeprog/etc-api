import { evaluateVehicleQuality } from './vehicle-quality.helpers';
import type { VehicleQualityInput } from './vehicle-quality.types';

const REFERENCE_NOW = new Date('2026-06-28T00:00:00.000Z');

function buildVehicle(
  overrides: Partial<VehicleQualityInput> = {},
): VehicleQualityInput {
  return {
    id: 'vehicle-1',
    stockNumber: 'ETC-2026-001',
    brand: 'Toyota',
    model: 'Vios',
    year: 2022,
    variant: '1.3 XLE CVT',
    mileage: 18450,
    transmission: 'CVT',
    fuelType: 'Gasoline',
    color: 'Pearl White',
    region: 'NCR',
    features: 'Backup camera, push-start',
    purchasePrice: '550000.00',
    targetSellingPrice: '650000.00',
    minimumAcceptablePrice: '610000.00',
    acquisitionSource: 'walk-in',
    sellerLeadId: null,
    status: 'Available',
    photos: [
      { fileUrl: '/uploads/vehicles/1.jpg', sortOrder: 0 },
      { fileUrl: '/uploads/vehicles/2.jpg', sortOrder: 1 },
      { fileUrl: '/uploads/vehicles/3.jpg', sortOrder: 2 },
    ],
    trackedCosts: [
      {
        id: 'cost-1',
        category: 'reconditioning',
        amount: '12000.00',
        note: 'Detail + tires',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ],
    createdAt: new Date('2026-06-20T00:00:00.000Z'),
    ...overrides,
  };
}

describe('evaluateVehicleQuality', () => {
  it('grades a fully populated, fresh available vehicle as excellent', () => {
    const result = evaluateVehicleQuality(buildVehicle(), REFERENCE_NOW);

    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe('excellent');
    expect(result.blockingIssues).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('flags missing pricing as critical for available vehicles', () => {
    const result = evaluateVehicleQuality(
      buildVehicle({
        targetSellingPrice: null,
        minimumAcceptablePrice: null,
        photos: [],
      }),
      REFERENCE_NOW,
    );

    expect(result.score).toBeLessThan(75);
    const codes = result.blockingIssues.map((issue) => issue.code);
    expect(codes).toContain('commercial.target_price_missing');
    expect(codes).toContain('commercial.minimum_price_missing');
    expect(codes).toContain('media.no_photos');
    expect(codes).toContain('status.available_not_sales_ready');
  });

  it('flags minimum > target as a critical pricing inconsistency', () => {
    const result = evaluateVehicleQuality(
      buildVehicle({
        targetSellingPrice: '600000.00',
        minimumAcceptablePrice: '650000.00',
      }),
      REFERENCE_NOW,
    );

    expect(
      result.blockingIssues.some(
        (issue) => issue.code === 'commercial.minimum_above_target',
      ),
    ).toBe(true);
  });

  it('warns when target price is below purchase price', () => {
    const result = evaluateVehicleQuality(
      buildVehicle({
        purchasePrice: '700000.00',
        targetSellingPrice: '650000.00',
        minimumAcceptablePrice: '600000.00',
      }),
      REFERENCE_NOW,
    );

    expect(
      result.warnings.some(
        (issue) => issue.code === 'commercial.target_below_purchase',
      ),
    ).toBe(true);
  });

  it('flags stale active inventory beyond 60 days as info', () => {
    const result = evaluateVehicleQuality(
      buildVehicle({
        createdAt: new Date(REFERENCE_NOW.getTime() - 70 * 24 * 60 * 60 * 1000),
      }),
      REFERENCE_NOW,
    );

    expect(
      result.suggestions.some(
        (issue) => issue.code === 'freshness.stale_warning',
      ),
    ).toBe(true);
  });

  it('flags stale active inventory beyond 90 days as warning', () => {
    const result = evaluateVehicleQuality(
      buildVehicle({
        createdAt: new Date(
          REFERENCE_NOW.getTime() - 100 * 24 * 60 * 60 * 1000,
        ),
      }),
      REFERENCE_NOW,
    );

    expect(
      result.warnings.some(
        (issue) => issue.code === 'freshness.stale_critical',
      ),
    ).toBe(true);
  });

  it('does not penalize sold vehicles for active-inventory checks', () => {
    const oldSold = evaluateVehicleQuality(
      buildVehicle({
        status: 'Sold',
        photos: [],
        createdAt: new Date(
          REFERENCE_NOW.getTime() - 200 * 24 * 60 * 60 * 1000,
        ),
        trackedCosts: [],
      }),
      REFERENCE_NOW,
    );

    expect(
      oldSold.warnings.some(
        (issue) => issue.code === 'freshness.stale_critical',
      ),
    ).toBe(false);
    expect(
      oldSold.blockingIssues.some((issue) => issue.code === 'media.no_photos'),
    ).toBe(false);
    expect(
      oldSold.suggestions.some(
        (issue) => issue.code === 'profitability.no_tracked_costs',
      ),
    ).toBe(false);
  });

  it('returns a deterministic lastEvaluatedAt from the provided clock', () => {
    const result = evaluateVehicleQuality(buildVehicle(), REFERENCE_NOW);
    expect(result.lastEvaluatedAt).toBe(REFERENCE_NOW.toISOString());
  });

  it('treats vehicles with few photos as a suggestion, not a blocker', () => {
    const result = evaluateVehicleQuality(
      buildVehicle({
        photos: [{ fileUrl: '/uploads/vehicles/1.jpg', sortOrder: 0 }],
      }),
      REFERENCE_NOW,
    );

    expect(
      result.suggestions.some((issue) => issue.code === 'media.few_photos'),
    ).toBe(true);
    expect(
      result.blockingIssues.some((issue) => issue.code === 'media.no_photos'),
    ).toBe(false);
  });

  it('suggests adding tracked costs when none are recorded on active inventory', () => {
    const result = evaluateVehicleQuality(
      buildVehicle({ trackedCosts: [] }),
      REFERENCE_NOW,
    );

    expect(
      result.suggestions.some(
        (issue) => issue.code === 'profitability.no_tracked_costs',
      ),
    ).toBe(true);
  });

  it('grades incomplete vehicles below 50', () => {
    const result = evaluateVehicleQuality(
      buildVehicle({
        brand: '',
        model: '',
        year: 0,
        mileage: null,
        transmission: null,
        fuelType: null,
        color: null,
        variant: null,
        purchasePrice: null,
        targetSellingPrice: null,
        minimumAcceptablePrice: null,
        photos: [],
        trackedCosts: [],
        status: 'Incoming',
      }),
      REFERENCE_NOW,
    );

    expect(result.score).toBeLessThan(50);
    expect(result.grade).toBe('incomplete');
  });
});
