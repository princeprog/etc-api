export class ListFinancingApplicationsQueryDto {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  partnerId?: string;
  representativeUserId?: string;
  assignedStaffUserId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export class CreateFinancingPartnerDto {
  name!: string;
  contactPerson?: string | null;
  contactNumber?: string | null;
  email?: string | null;
  notes?: string | null;
}

export class UpdateFinancingPartnerDto {
  name?: string;
  contactPerson?: string | null;
  contactNumber?: string | null;
  email?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export class UpsertPartnerRepresentativeDto {
  userId!: string;
  isActive?: boolean;
}

export class CreateRequirementTemplateDto {
  partnerId!: string;
  name!: string;
  description?: string | null;
  isDefault?: boolean;
  items?: RequirementTemplateItemDto[];
}

export class UpdateRequirementTemplateDto {
  name?: string;
  description?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  items?: RequirementTemplateItemDto[];
}

export class RequirementTemplateItemDto {
  id?: string;
  label!: string;
  description?: string | null;
  isRequired?: boolean;
  sortOrder?: number;
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
  partnerId?: string;
  representativeUserId!: string;
  assignedStaffUserId?: string | null;
  templateId?: string | null;
  requestedAmount?: string | null;
  downPayment?: string | null;
  termMonths?: number | null;
}

export class UpdateFinancingApplicationDto {
  partnerId?: string;
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
