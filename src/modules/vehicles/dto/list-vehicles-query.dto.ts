import type { VehicleStatus } from '../../../database/schema';

export class ListVehiclesQueryDto {
  status?: VehicleStatus;
  model?: string;
}
