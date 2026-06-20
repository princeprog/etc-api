import type { Vehicle, VehicleStatus } from '../../database/schema';

export type VehiclePhotoInput = {
  fileUrl: string;
  sortOrder?: number;
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
  createdAt: Date;
  updatedAt: Date;
};
