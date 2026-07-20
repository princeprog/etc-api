import type {
  BuyerLeadStatus,
  SellerLeadStatus,
  VehicleStatus,
} from '../../database/schema';

export type BuyerLeadPipelineContext = {
  id: string;
  status: BuyerLeadStatus;
  contactNumber: string;
  email: string | null;
  facebookName: string | null;
  assigneeUserId: string | null;
  closingNote: string | null;
  latestActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  vehicles: Array<{
    id: string;
    status: VehicleStatus;
  }>;
  followUps: Array<{
    dueAt: Date;
    completedAt: Date | null;
    cancelledAt: Date | null;
  }>;
  sales: Array<{
    id: string;
  }>;
};

export type SellerLeadPipelineContext = {
  id: string;
  status: SellerLeadStatus;
  contactNumber: string;
  email: string | null;
  facebookName: string | null;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYear: number | null;
  askingPrice: string | null;
  assigneeUserId: string | null;
  latestActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  vehicleId: string | null;
  followUps: Array<{
    dueAt: Date;
    completedAt: Date | null;
    cancelledAt: Date | null;
  }>;
};
