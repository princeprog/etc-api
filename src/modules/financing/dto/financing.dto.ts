export class ListFinancingApplicationsQueryDto {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  representativeUserId?: string;
  assignedStaffUserId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export class CreateFinancingRequirementDto {
  label!: string;
  description?: string | null;
}

export class UpdateFinancingRequirementDto {
  label?: string;
  description?: string | null;
}

export class CreateFinancingApplicationDto {
  buyerLeadId!: string;
  vehicleId!: string;
  representativeUserId!: string;
  assignedStaffUserId?: string | null;
  requestedAmount?: string | null;
  downPayment?: string | null;
  termMonths?: number | null;
}

export class UpdateFinancingApplicationDto {
  representativeUserId?: string;
  assignedStaffUserId?: string;
  requestedAmount?: string | null;
  downPayment?: string | null;
  termMonths?: number | null;
}

export class ReviewFinancingRequirementDto {
  status!: 'accepted' | 'revision_requested';
  note?: string | null;
  revisionReason?: string | null;
}

export class DecideFinancingApplicationDto {
  decision!: 'approved' | 'rejected';
  note?: string | null;
}

export class RecordLoanReleaseDto {
  releasedLoanAmount!: string;
  loanReleasedAt!: string;
  loanReleaseReference?: string | null;
}

export class RecordVehicleReleaseDto {
  vehicleReleasedAt?: string | null;
  note?: string | null;
}

export class CancelFinancingApplicationDto {
  reason!: string;
}

export class VerifyFinancingUploadDto {
  contactNumber!: string;
}

export class SubmitFinancingUploadDto {
  sessionToken!: string;
}
