import { validateVehicleAvailability } from './vehicles.helpers';
import type { VehicleWriteModel } from './vehicles.types';

function buildVehicleWriteModel(
  overrides: Partial<VehicleWriteModel> = {},
): VehicleWriteModel {
  return {
    stockNumber: 'STK-2024-00125',
    brand: 'Toyota',
    model: 'Fortuner',
    year: 2021,
    variant: 'V',
    mileage: null,
    transmission: 'AT',
    fuelType: 'Diesel',
    color: null,
    region: null,
    features: null,
    remarks: null,
    purchasePrice: '1280000.00',
    targetSellingPrice: '1650000.00',
    minimumAcceptablePrice: '1500000.00',
    acquisitionSource: null,
    sellerLeadId: null,
    status: 'Available',
    photos: [{ fileUrl: '/uploads/vehicles/test.jpg', sortOrder: 0 }],
    ...overrides,
  };
}

describe('validateVehicleAvailability', () => {
  it('requires a photo when Available readiness is required', () => {
    expect(() =>
      validateVehicleAvailability(
        buildVehicleWriteModel({
          photos: [],
        }),
      ),
    ).toThrow('At least one photo is required');
  });

  it('allows pricing-only validation to skip Available photo readiness', () => {
    expect(() =>
      validateVehicleAvailability(
        buildVehicleWriteModel({
          photos: [],
        }),
        { requireAvailableReadiness: false },
      ),
    ).not.toThrow();
  });

  it('still blocks Sold status when Available readiness is skipped', () => {
    expect(() =>
      validateVehicleAvailability(
        buildVehicleWriteModel({
          status: 'Sold',
          photos: [],
        }),
        { requireAvailableReadiness: false },
      ),
    ).toThrow('Vehicles can only move to Sold');
  });
});
