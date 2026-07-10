import type {
  Vehicle,
  VehicleStatus,
  VehicleTrackedCostCategory,
} from '../../database/schema';
import type { VehicleQualityScore } from './vehicle-quality.types';

export type VehiclePhotoInput = {
  fileUrl: string;
  sortOrder?: number;
};

export type VehicleTrackedCostResponse = {
  id: string;
  category: VehicleTrackedCostCategory;
  amount: string;
  note: string;
  createdAt: Date;
  updatedAt: Date;
};

export type VehicleTrackedCostsPageResponse = {
  trackedCosts: VehicleTrackedCostResponse[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type VehicleWriteModel = {
  stockNumber: string;
  brand: string;
  model: string;
  year: number;
  variant: string | null;
  mileage: number | null;
  transmission: string | null;
  fuelType: string | null;
  color: string | null;
  region: string | null;
  features: string | null;
  remarks: string | null;
  purchasePrice: string | null;
  targetSellingPrice: string | null;
  minimumAcceptablePrice: string | null;
  acquisitionSource: string | null;
  sellerLeadId: string | null;
  status: VehicleStatus;
  photos: VehiclePhotoInput[];
};

export type VehicleResponse = {
  id: Vehicle['id'];
  stockNumber: string;
  brand: string;
  model: string;
  year: number;
  variant: string | null;
  mileage: number | null;
  transmission: string | null;
  fuelType: string | null;
  color: string | null;
  region: string | null;
  features: string | null;
  remarks: string | null;
  purchasePrice: string | null;
  targetSellingPrice: string | null;
  minimumAcceptablePrice: string | null;
  acquisitionSource: string | null;
  sellerLeadId: string | null;
  status: VehicleStatus;
  photos: VehiclePhotoInput[];
  trackedCosts: VehicleTrackedCostResponse[];
  trackedCostsTotal: string;
  qualityScore: VehicleQualityScore;
  createdAt: Date;
  updatedAt: Date;
};
