import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';

import { DATABASE } from '../../database/database.constants';
import type { DB } from '../../database/db';
import { CompleteFollowUpDto } from './dto/complete-follow-up.dto';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { mapFollowUpResponse, parseFollowUpStatus, parseLeadType } from './follow-ups.helpers';

@Injectable()
export class FollowUpsService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async create(dto: CreateFollowUpDto) {
    const leadType = parseLeadType(dto.leadType);
    const note = dto.note?.trim();

    if (!dto.assigneeUserId) {
      throw new BadRequestException('assigneeUserId is required');
    }

    if (!dto.dueAt) {
      throw new BadRequestException('dueAt is required');
    }

    if (!note) {
      throw new BadRequestException('note is required');
    }

    if (leadType === 'buyer') {
      if (!dto.buyerLeadId || dto.sellerLeadId) {
        throw new BadRequestException('buyer lead follow-up must include only buyerLeadId');
      }

      await this.ensureBuyerLeadExists(dto.buyerLeadId);
    }

    if (leadType === 'seller') {
      if (!dto.sellerLeadId || dto.buyerLeadId) {
        throw new BadRequestException('seller lead follow-up must include only sellerLeadId');
      }

      await this.ensureSellerLeadExists(dto.sellerLeadId);
    }

    const inserted = await this.db
      .insertInto('crm.follow_ups')
      .values({
        lead_type: leadType,
        seller_lead_id: dto.sellerLeadId ?? null,
        buyer_lead_id: dto.buyerLeadId ?? null,
        assignee_user_id: dto.assigneeUserId,
        due_at: new Date(dto.dueAt),
        status: 'Due',
        note,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    return { followUp: await this.getFollowUpOrThrow(inserted.id) };
  }

  async findAll(status?: string) {
    const parsedStatus = parseFollowUpStatus(status);
    const followUps = await this.db
      .selectFrom('crm.follow_ups')
      .select(['id'])
      .orderBy('due_at', 'asc')
      .execute();

    const hydrated = await Promise.all(followUps.map((followUp) => this.getFollowUpOrThrow(followUp.id)));
    return {
      followUps: hydrated.filter((followUp) => {
        if (!parsedStatus) {
          return true;
        }

        return followUp.status === parsedStatus;
      }),
    };
  }

  async findOne(id: string) {
    return { followUp: await this.getFollowUpOrThrow(id) };
  }

  async complete(id: string, dto: CompleteFollowUpDto) {
    const followUp = await this.getRecordOrThrow(id);
    const outcomeNote = dto.outcomeNote?.trim();

    if (!outcomeNote) {
      throw new BadRequestException('outcomeNote is required');
    }

    if (followUp.completed_at) {
      throw new BadRequestException('Follow-up is already completed');
    }

    await this.db
      .updateTable('crm.follow_ups')
      .set({
        status: 'Completed',
        completed_at: new Date(),
        outcome_note: outcomeNote,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    return { followUp: await this.getFollowUpOrThrow(id) };
  }

  private async getFollowUpOrThrow(id: string) {
    const followUp = await this.getRecordOrThrow(id);
    const computedStatus =
      !followUp.completed_at && followUp.due_at < new Date() ? 'Overdue' : followUp.status;

    return mapFollowUpResponse({
      ...followUp,
      lead_type: parseLeadType(followUp.lead_type),
      status: parseFollowUpStatus(computedStatus) ?? 'Due',
    });
  }

  private async getRecordOrThrow(id: string) {
    const followUp = await this.db
      .selectFrom('crm.follow_ups')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!followUp) {
      throw new NotFoundException(`Follow-up ${id} was not found`);
    }

    return followUp;
  }

  private async ensureBuyerLeadExists(id: string) {
    const buyerLead = await this.db
      .selectFrom('crm.buyer_leads')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!buyerLead) {
      throw new NotFoundException(`Buyer lead ${id} was not found`);
    }
  }

  private async ensureSellerLeadExists(id: string) {
    const sellerLead = await this.db
      .selectFrom('crm.seller_leads')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!sellerLead) {
      throw new NotFoundException(`Seller lead ${id} was not found`);
    }
  }
}
