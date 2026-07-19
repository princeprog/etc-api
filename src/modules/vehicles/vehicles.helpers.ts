import { BadRequestException } from '@nestjs/common';

import type {
  VehicleStatus,
  VehicleTrackedCostCategory,
} from '../../database/schema';
import { evaluateVehicleQuality } from './vehicle-quality.helpers';
import type {
  VehiclePhotoInput,
  VehicleResponse,
  VehicleTrackedCostResponse,
  VehicleWriteModel,
} from './vehicles.types';

const VEHICLE_STATUSES: VehicleStatus[] = [
  'Incoming',
  'Reconditioning',
  'Available',
  'Reserved',
  'Sold',
];

const VEHICLE_TRACKED_COST_CATEGORIES: VehicleTrackedCostCategory[] = [
  'reconditioning',
  'repair',
  'detailing',
  'transport',
  'documentation',
  'miscellaneous',
];

export function formatVehicleStockNumber(year: number, sequence: number) {
  return `ETC-${year}-${String(sequence).padStart(3, '0')}`;
}

export function normalizeVehiclePhotos(
  photos: VehiclePhotoInput[] | undefined,
): VehiclePhotoInput[] {
  return (photos ?? []).map((photo, index) => {
    const fileUrl = photo.fileUrl?.trim();

    if (!fileUrl) {
      throw new BadRequestException('Vehicle photo fileUrl is required');
    }

    return {
      fileUrl,
      sortOrder: photo.sortOrder ?? index,
    };
  });
}

export function parseVehicleStatus(
  value: string | undefined,
  fallback: VehicleStatus,
): VehicleStatus {
  if (!value) {
    return fallback;
  }

  if (!VEHICLE_STATUSES.includes(value as VehicleStatus)) {
    throw new BadRequestException(`Unsupported vehicle status: ${value}`);
  }

  return value as VehicleStatus;
}

export function parseVehicleTrackedCostCategory(
  value: string | undefined,
  fallback?: VehicleTrackedCostCategory,
): VehicleTrackedCostCategory {
  if (!value) {
    if (fallback) {
      return fallback;
    }

    throw new BadRequestException('Tracked cost category is required');
  }

  if (
    !VEHICLE_TRACKED_COST_CATEGORIES.includes(
      value as VehicleTrackedCostCategory,
    )
  ) {
    throw new BadRequestException(
      `Unsupported tracked cost category: ${value}`,
    );
  }

  return value as VehicleTrackedCostCategory;
}

export function normalizeTrackedCostAmount(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new BadRequestException('Tracked cost amount is required');
  }

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new BadRequestException(
      'Tracked cost amount must be a valid monetary value',
    );
  }

  return Number(trimmed).toFixed(2);
}

export function normalizeTrackedCostNote(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new BadRequestException('Tracked cost note is required');
  }

  return trimmed;
}

export function validateVehicleAvailability(
  model: VehicleWriteModel,
  options: {
    allowSoldStatus?: boolean;
    requireAvailableReadiness?: boolean;
  } = {},
): void {
  if (model.status === 'Sold' && !options.allowSoldStatus) {
    throw new BadRequestException(
      'Vehicles can only move to Sold through the sales finalization workflow',
    );
  }

  if (
    model.status !== 'Available' ||
    options.requireAvailableReadiness === false
  ) {
    return;
  }

  if (!model.targetSellingPrice) {
    throw new BadRequestException(
      'targetSellingPrice is required before moving a vehicle to Available',
    );
  }

  if (!model.minimumAcceptablePrice) {
    throw new BadRequestException(
      'minimumAcceptablePrice is required before moving a vehicle to Available',
    );
  }

  if (model.photos.length === 0) {
    throw new BadRequestException(
      'At least one photo is required before moving a vehicle to Available',
    );
  }
}

export function mapVehicleResponse(vehicle: {
  id: string;
  stock_number: string;
  brand: string;
  model: string;
  year: number;
  variant: string | null;
  mileage: number | null;
  transmission: string | null;
  fuel_type: string | null;
  color: string | null;
  region: string | null;
  features: string | null;
  remarks: string | null;
  purchase_price: string | null;
  target_selling_price: string | null;
  minimum_acceptable_price: string | null;
  acquisition_source: string | null;
  seller_lead_id: string | null;
  status: VehicleStatus;
  created_at: Date;
  updated_at: Date;
  photos: VehiclePhotoInput[];
  trackedCosts: VehicleTrackedCostResponse[];
  trackedCostsTotal: string;
}): VehicleResponse {
  const qualityScore = evaluateVehicleQuality({
    id: vehicle.id,
    stockNumber: vehicle.stock_number,
    brand: vehicle.brand,
    model: vehicle.model,
    year: vehicle.year,
    variant: vehicle.variant,
    mileage: vehicle.mileage,
    transmission: vehicle.transmission,
    fuelType: vehicle.fuel_type,
    color: vehicle.color,
    region: vehicle.region,
    features: vehicle.features,
    purchasePrice: vehicle.purchase_price,
    targetSellingPrice: vehicle.target_selling_price,
    minimumAcceptablePrice: vehicle.minimum_acceptable_price,
    acquisitionSource: vehicle.acquisition_source,
    sellerLeadId: vehicle.seller_lead_id,
    status: vehicle.status,
    photos: vehicle.photos,
    trackedCosts: vehicle.trackedCosts,
    createdAt: vehicle.created_at,
  });

  return {
    id: vehicle.id,
    stockNumber: vehicle.stock_number,
    brand: vehicle.brand,
    model: vehicle.model,
    year: vehicle.year,
    variant: vehicle.variant,
    mileage: vehicle.mileage,
    transmission: vehicle.transmission,
    fuelType: vehicle.fuel_type,
    color: vehicle.color,
    region: vehicle.region,
    features: vehicle.features,
    remarks: vehicle.remarks,
    purchasePrice: vehicle.purchase_price,
    targetSellingPrice: vehicle.target_selling_price,
    minimumAcceptablePrice: vehicle.minimum_acceptable_price,
    acquisitionSource: vehicle.acquisition_source,
    sellerLeadId: vehicle.seller_lead_id,
    status: vehicle.status,
    photos: vehicle.photos,
    trackedCosts: vehicle.trackedCosts,
    trackedCostsTotal: vehicle.trackedCostsTotal,
    qualityScore,
    createdAt: vehicle.created_at,
    updatedAt: vehicle.updated_at,
  };
}
