export const DEFAULT_STALE_LEAD_DAYS = 7;

export const BUYER_PIPELINE_TERMINAL_STAGES = [
  'won_sale_finalized',
  'lost_closed',
] as const;

export const SELLER_PIPELINE_TERMINAL_STAGES = [
  'acquired_vehicle_created',
  'rejected_closed',
] as const;
