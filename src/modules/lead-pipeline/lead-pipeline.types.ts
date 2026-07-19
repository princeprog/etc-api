export type LeadPipelineActionTarget =
  | 'follow_up'
  | 'sale_finalization'
  | 'lead_edit'
  | 'vehicle_create';

export type LeadPipelineSeverity = 'critical' | 'warning' | 'info';

export type LeadPipelineBlocker = {
  code: string;
  label: string;
  description: string;
  severity: LeadPipelineSeverity;
  target?: LeadPipelineActionTarget;
};

export type LeadPipelineNextAction = {
  code: string;
  label: string;
  description: string;
  target?: LeadPipelineActionTarget;
};

export type LeadPipelineState = {
  stage: string;
  stageLabel: string;
  progressPercent: number;
  nextAction: LeadPipelineNextAction | null;
  blockers: LeadPipelineBlocker[];
  warnings: LeadPipelineBlocker[];
  lastActivityAt: Date | null;
  isStale: boolean;
  context: {
    openFollowUpCount: number;
    latestFollowUpAt: Date | null;
    latestCompletedFollowUpAt: Date | null;
    finalizedSaleCount?: number;
    vehicleCreated?: boolean;
    staleAfterDays: number;
  };
};
