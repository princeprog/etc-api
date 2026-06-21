import type { VehicleStatus } from '../../../database/schema';
import { VehiclePhotoDto } from '../../vehicles/dto/vehicle-photo.dto';

export class ConvertSellerLeadDto {
  year?: number;
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
  status?: VehicleStatus;
  photos?: VehiclePhotoDto[];
}
