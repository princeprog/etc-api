import type { VehicleTrackedCostCategory } from '../../../database/schema';

export class VehicleTrackedCostDto {
  category!: VehicleTrackedCostCategory;
  amount!: string;
  note!: string;
}
