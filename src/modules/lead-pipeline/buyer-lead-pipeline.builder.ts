import type { LeadPipelineBlocker, LeadPipelineNextAction, LeadPipelineState } from './lead-pipeline.types';
import type { BuyerLeadPipelineContext } from './lead-pipeline.contexts';
import { getLatestDate, getPipelineStaleLeadDays, isPipelineStale, resolveLastActivityAt } from './lead-pipeline.utils';

export function buildBuyerLeadPipeline(
  lead: BuyerLeadPipelineContext,
): LeadPipelineState {
  const staleAfterDays = getPipelineStaleLeadDays();
  const blockers: LeadPipelineBlocker[] = [];
  const warnings: LeadPipelineBlocker[] = [];
  const lastActivityAt = resolveLastActivityAt(lead);
  const isClosed = lead.status === 'Won' || lead.status === 'Lost';
  const isStale = !isClosed && isPipelineStale(lastActivityAt, staleAfterDays);
  const openFollowUps = lead.followUps.filter((followUp) => !followUp.completedAt);
  const completedFollowUps = lead.followUps.filter(
    (followUp) => followUp.completedAt,
  );
  const hasMeaningfulContact = lead.status !== 'New Inquiry';
  const hasUpcomingFollowUp = openFollowUps.some(
    (followUp) => !followUp.completedAt && followUp.dueAt >= new Date(),
  );
  const hasSale = lead.sales.length > 0;
  const hasContactInfo = Boolean(
    lead.contactNumber.trim() || lead.email || lead.facebookName,
  );

  if (!hasContactInfo) {
    blockers.push({
      code: 'buyer_contact_missing',
      label: 'Missing contact details',
      description: 'Add buyer contact information before progressing this lead.',
      severity: 'critical',
      target: 'lead_edit',
    });
  }

  if (!isClosed && !hasUpcomingFollowUp) {
    warnings.push({
      code: 'buyer_follow_up_missing',
      label: 'No upcoming follow-up',
      description: 'Schedule a follow-up to keep this buyer lead active.',
      severity: 'warning',
      target: 'follow_up',
    });
  }

  if (lead.status === 'Won' && !lead.closingNote?.trim()) {
    blockers.push({
      code: 'buyer_closing_note_missing',
      label: 'Missing closing note',
      description: 'Add the closing note that explains how this sale was won.',
      severity: 'warning',
      target: 'lead_edit',
    });
  }

  if (lead.status === 'Won') {
    blockers.push({
      code: 'buyer_already_won',
      label: 'Lead already won',
      description: 'This buyer is already won and cannot be used for a new sale.',
      severity: 'info',
      target: 'sale_finalization',
    });
  }

  if (isStale) {
    warnings.push({
      code: 'buyer_stale',
      label: 'Stale buyer lead',
      description: `No recent activity has been recorded in the last ${staleAfterDays} days.`,
      severity: 'warning',
      target: 'follow_up',
    });
  }

  let stage = 'new_lead';
  let stageLabel = 'New Lead';
  let progressPercent = 10;

  if (lead.status === 'Lost') {
    stage = 'lost_closed';
    stageLabel = 'Lost / Closed';
    progressPercent = 100;
  } else if (hasSale || lead.status === 'Won') {
    stage = 'won_sale_finalized';
    stageLabel = 'Won / Sale Finalized';
    progressPercent = 100;
  } else if (lead.status === 'Reserved') {
    stage = 'sale_finalization_pending';
    stageLabel = 'Sale Finalization Pending';
    progressPercent = 85;
  } else if (lead.status === 'Negotiating' || lead.status === 'Interested') {
    stage = 'active_buyer';
    stageLabel = 'Active Buyer';
    progressPercent = 60;
  } else if (hasMeaningfulContact || lead.followUps.length > 0) {
    stage = 'contacted_follow_up';
    stageLabel = 'Contacted / In Follow-up';
    progressPercent = 30;
  }

  let nextAction: LeadPipelineNextAction | null = null;

  if (stage === 'won_sale_finalized' || stage === 'lost_closed') {
    nextAction = null;
  } else if (isStale) {
    nextAction = {
      code: 'review_stale_lead',
      label: 'Review stale lead',
      description: 'Reconnect with this buyer lead and confirm whether it should still progress.',
      target: 'follow_up',
    };
  } else if (!hasUpcomingFollowUp) {
    nextAction = {
      code: 'schedule_follow_up',
      label: 'Schedule follow-up',
      description: 'Schedule a follow-up to keep this buyer lead moving.',
      target: 'follow_up',
    };
  } else if (lead.status === 'Reserved') {
    nextAction = {
      code: 'finalize_sale',
      label: 'Finalize sale',
      description: 'Complete the sale workflow for this reserved buyer.',
      target: 'sale_finalization',
    };
  } else {
    nextAction = {
      code: 'review_buyer_lead',
      label: 'Review buyer lead',
      description: 'Review buyer requirements, notes, and follow-up history.',
      target: 'lead_edit',
    };
  }

  return {
    stage,
    stageLabel,
    progressPercent,
    nextAction,
    blockers,
    warnings,
    lastActivityAt,
    isStale,
    context: {
      openFollowUpCount: openFollowUps.length,
      latestFollowUpAt: getLatestDate(openFollowUps.map((followUp) => followUp.dueAt)),
      latestCompletedFollowUpAt: getLatestDate(
        completedFollowUps
          .map((followUp) => followUp.completedAt)
          .filter((value): value is Date => value instanceof Date),
      ),
      finalizedSaleCount: lead.sales.length,
      staleAfterDays,
    },
  };
}
