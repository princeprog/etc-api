import type { Json } from '../../database/db';
import type { ActivityEntityType } from '../../database/schema';

const ACTIVITY_ENTITY_TYPES: ActivityEntityType[] = [
  'seller_lead',
  'buyer_lead',
  'vehicle',
  'sale',
  'follow_up',
  'user',
  'financing_application',
  'expense',
  'expense_category',
  'expense_recurring_rule',
];

export function parseActivityEntityType(value: string): ActivityEntityType {
  if (ACTIVITY_ENTITY_TYPES.includes(value as ActivityEntityType)) {
    return value as ActivityEntityType;
  }

  throw new Error(`Unsupported activity entity type: ${value}`);
}

export function parseActivityMetadata(
  value: Json | null,
): Record<string, unknown> | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return null;
  }

  return value as Record<string, unknown>;
}

export function mapActivityHistoryResponse(event: {
  id: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  entity_type: string;
  entity_id: string;
  action_type: string;
  summary: string;
  metadata: Json | null;
  created_at: Date;
}) {
  return {
    id: event.id,
    actorUserId: event.actor_user_id,
    actorDisplayName: event.actor_display_name,
    entityType: parseActivityEntityType(event.entity_type),
    entityId: event.entity_id,
    actionType: event.action_type,
    summary: event.summary,
    metadata: parseActivityMetadata(event.metadata) ?? {},
    timestamp: event.created_at,
  };
}
