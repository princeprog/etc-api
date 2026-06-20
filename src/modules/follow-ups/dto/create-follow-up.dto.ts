import type { LeadType } from '../../../database/schema';

export class CreateFollowUpDto {
  leadType!: LeadType;
  sellerLeadId?: string;
  buyerLeadId?: string;
  assigneeUserId!: string;
  dueAt!: string;
  note!: string;
}
