import { BadRequestException } from '@nestjs/common';

import type { FollowUpStatus, LeadType } from '../../database/schema';

const FOLLOW_UP_STATUSES: FollowUpStatus[] = ['Due', 'Completed', 'Overdue'];
const LEAD_TYPES: LeadType[] = ['seller', 'buyer'];

export function parseFollowUpStatus(value: string | undefined): FollowUpStatus | undefined {
  if (!value) {
    return undefined;
  }

  if (!FOLLOW_UP_STATUSES.includes(value as FollowUpStatus)) {
    throw new BadRequestException(`Unsupported follow-up status: ${value}`);
  }

  return value as FollowUpStatus;
}

export function parseLeadType(value: string): LeadType {
  if (!LEAD_TYPES.includes(value as LeadType)) {
    throw new BadRequestException(`Unsupported lead type: ${value}`);
  }

  return value as LeadType;
}

export function mapFollowUpResponse(followUp: {
  id: string;
  lead_type: LeadType;
  seller_lead_id: string | null;
  buyer_lead_id: string | null;
  assignee_user_id: string;
  due_at: Date;
  completed_at: Date | null;
  status: FollowUpStatus;
  note: string;
  outcome_note: string | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: followUp.id,
    leadType: followUp.lead_type,
    sellerLeadId: followUp.seller_lead_id,
    buyerLeadId: followUp.buyer_lead_id,
    assigneeUserId: followUp.assignee_user_id,
    dueAt: followUp.due_at,
    completedAt: followUp.completed_at,
    status: followUp.status,
    note: followUp.note,
    outcomeNote: followUp.outcome_note,
    createdAt: followUp.created_at,
    updatedAt: followUp.updated_at,
  };
}
