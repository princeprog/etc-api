import type { VehicleTrackedCostCategory } from '../../../database/schema';

export class UpdateVehicleTrackedCostDto {
  category?: VehicleTrackedCostCategory;
  amount?: string;
  note?: string;
}
