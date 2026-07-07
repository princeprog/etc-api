import type { VehicleStatus } from '../../database/schema';
import type {
  VehiclePhotoInput,
  VehicleTrackedCostResponse,
} from './vehicles.types';

export type VehicleQualityGrade =
  | 'excellent'
  | 'good'
  | 'needs_attention'
  | 'incomplete';

export type VehicleQualityIssueSeverity = 'critical' | 'warning' | 'info';

export interface VehicleQualityIssue {
  code: string;
  label: string;
  description: string;
  severity: VehicleQualityIssueSeverity;
  field?: string;
}

export interface VehicleQualityScore {
  score: number;
  grade: VehicleQualityGrade;
  blockingIssues: VehicleQualityIssue[];
  warnings: VehicleQualityIssue[];
  suggestions: VehicleQualityIssue[];
  lastEvaluatedAt: string;
}

export interface VehicleQualityInput {
  id: string;
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
  purchasePrice: string | null;
  targetSellingPrice: string | null;
  minimumAcceptablePrice: string | null;
  acquisitionSource: string | null;
  sellerLeadId: string | null;
  status: VehicleStatus;
  photos: VehiclePhotoInput[];
  trackedCosts: VehicleTrackedCostResponse[];
  createdAt: Date;
}
