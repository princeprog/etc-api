import type { LeadPipelineBlocker, LeadPipelineNextAction, LeadPipelineState } from './lead-pipeline.types';
import type { SellerLeadPipelineContext } from './lead-pipeline.contexts';
import { getLatestDate, getPipelineStaleLeadDays, isPipelineStale, resolveLastActivityAt } from './lead-pipeline.utils';

export function buildSellerLeadPipeline(
  lead: SellerLeadPipelineContext,
): LeadPipelineState {
  const staleAfterDays = getPipelineStaleLeadDays();
  const blockers: LeadPipelineBlocker[] = [];
  const warnings: LeadPipelineBlocker[] = [];
  const lastActivityAt = resolveLastActivityAt(lead);
  const isClosed = lead.status === 'Purchased' || lead.status === 'Rejected';
  const isStale = !isClosed && isPipelineStale(lastActivityAt, staleAfterDays);
  const openFollowUps = lead.followUps.filter((followUp) => !followUp.completedAt);
  const completedFollowUps = lead.followUps.filter(
    (followUp) => followUp.completedAt,
  );
  const hasUpcomingFollowUp = openFollowUps.some(
    (followUp) => !followUp.completedAt && followUp.dueAt >= new Date(),
  );
  const hasVehicleDetails = Boolean(
    lead.vehicleBrand.trim() && lead.vehicleModel.trim() && lead.vehicleYear !== null,
  );
  const hasAskingPrice = Boolean(lead.askingPrice);
  const readyForReview =
    hasVehicleDetails &&
    hasAskingPrice &&
    ['Evaluated', 'Negotiating', 'Approved to Buy'].includes(lead.status);

  if (!lead.contactNumber.trim() && !lead.email && !lead.facebookName) {
    blockers.push({
      code: 'seller_contact_missing',
      label: 'Missing contact details',
      description: 'Add seller contact information before progressing this lead.',
      severity: 'critical',
      target: 'lead_edit',
    });
  }

  if (!hasUpcomingFollowUp && !isClosed) {
    warnings.push({
      code: 'seller_follow_up_missing',
      label: 'No upcoming follow-up',
      description: 'Schedule a follow-up to keep this seller lead active.',
      severity: 'warning',
      target: 'follow_up',
    });
  }

  if (!hasVehicleDetails) {
    blockers.push({
      code: 'seller_vehicle_details_missing',
      label: 'Vehicle details incomplete',
      description: 'Complete the brand, model, and year before acquisition review.',
      severity: 'critical',
      target: 'lead_edit',
    });
  }

  if (hasVehicleDetails && !hasAskingPrice && lead.status !== 'Purchased') {
    blockers.push({
      code: 'seller_pricing_missing',
      label: 'Asking price missing',
      description: 'Add the seller asking price before acquisition review.',
      severity: 'critical',
      target: 'lead_edit',
    });
  }

  if (lead.status === 'Purchased' || lead.vehicleId) {
    blockers.push({
      code: 'seller_already_converted',
      label: 'Lead already converted',
      description: 'This seller lead has already resulted in an inventory vehicle.',
      severity: 'info',
      target: 'vehicle_create',
    });
  }

  if (lead.status === 'Rejected') {
    blockers.push({
      code: 'seller_closed',
      label: 'Lead closed',
      description: 'This seller lead is closed and should not move forward.',
      severity: 'info',
    });
  }

  if (isStale) {
    warnings.push({
      code: 'seller_stale',
      label: 'Stale seller lead',
      description: `No recent activity has been recorded in the last ${staleAfterDays} days.`,
      severity: 'warning',
      target: 'follow_up',
    });
  }

  let stage = 'new_seller_lead';
  let stageLabel = 'New Seller Lead';
  let progressPercent = 10;

  if (lead.status === 'Rejected') {
    stage = 'rejected_closed';
    stageLabel = 'Rejected / Closed';
    progressPercent = 100;
  } else if (lead.status === 'Purchased' || lead.vehicleId) {
    stage = 'acquired_vehicle_created';
    stageLabel = 'Acquired / Vehicle Created';
    progressPercent = 100;
  } else if (readyForReview) {
    stage = 'acquisition_review';
    stageLabel = 'Acquisition Review';
    progressPercent = 70;
  } else if (hasVehicleDetails) {
    stage = 'vehicle_details_captured';
    stageLabel = 'Vehicle Details Captured';
    progressPercent = 45;
  } else if (lead.followUps.length > 0 || lead.status !== 'New Inquiry') {
    stage = 'contacted_follow_up';
    stageLabel = 'Contacted / In Follow-up';
    progressPercent = 25;
  }

  let nextAction: LeadPipelineNextAction | null = null;

  if (stage === 'acquired_vehicle_created' || stage === 'rejected_closed') {
    nextAction = null;
  } else if (isStale) {
    nextAction = {
      code: 'review_stale_seller_lead',
      label: 'Review stale seller lead',
      description: 'Reconnect with this seller and confirm whether acquisition should continue.',
      target: 'follow_up',
    };
  } else if (!hasUpcomingFollowUp) {
    nextAction = {
      code: 'schedule_follow_up',
      label: 'Schedule follow-up',
      description: 'Schedule a follow-up to keep this seller lead moving.',
      target: 'follow_up',
    };
  } else if (!hasVehicleDetails || !hasAskingPrice) {
    nextAction = {
      code: 'complete_vehicle_details',
      label: 'Complete vehicle details',
      description: 'Fill in the missing vehicle details and seller asking price needed for review.',
      target: 'lead_edit',
    };
  } else if (lead.status !== 'Approved to Buy') {
    nextAction = {
      code: 'review_acquisition_decision',
      label: 'Review acquisition decision',
      description: 'Review the inspection details before deciding the acquisition path.',
      target: 'lead_edit',
    };
  } else {
    nextAction = {
      code: 'create_inventory_vehicle',
      label: 'Create inventory vehicle',
      description: 'Convert this approved seller lead into an inventory vehicle record.',
      target: 'vehicle_create',
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
      vehicleCreated: Boolean(lead.vehicleId),
      staleAfterDays,
    },
  };
}
