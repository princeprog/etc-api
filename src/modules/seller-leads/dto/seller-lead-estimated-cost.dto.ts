import type { VehicleTrackedCostCategory } from '../../../database/schema';

export class SellerLeadEstimatedCostDto {
  category!: VehicleTrackedCostCategory;
  amount!: string;
  note!: string;
}
