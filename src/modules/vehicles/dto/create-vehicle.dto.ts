import type { VehicleStatus } from '../../../database/schema';
import { VehiclePhotoDto } from './vehicle-photo.dto';

export class CreateVehicleDto {
  stockNumber!: string;
  brand!: string;
  model!: string;
  year!: number;
  variant?: string | null;
  mileage?: number | null;
  transmission?: string | null;
  fuelType?: string | null;
  color?: string | null;
  region?: string | null;
  features?: string | null;
  remarks?: string | null;
  purchasePrice?: string | null;
  targetSellingPrice?: string | null;
  minimumAcceptablePrice?: string | null;
  acquisitionSource?: string | null;
  sellerLeadId?: string | null;
  status?: VehicleStatus;
  photos?: VehiclePhotoDto[];
}
