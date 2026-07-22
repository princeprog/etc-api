export type InspectionAnswerDto = {
  rating?: 'good' | 'fair' | 'poor' | null;
  notes?: string | null;
};

export class StartSellerLeadInspectionDto {
  templateVersionId?: string;
}

export class UpdateSellerLeadInspectionDto {
  answers?: Record<string, InspectionAnswerDto>;
  majorIssues?: string | null;
  recommendedRepairs?: string | null;
  inspectorNotes?: string | null;
  estimatedRepairCost?: string | number | null;
  overallCondition?: 'good' | 'fair' | 'poor';
}
