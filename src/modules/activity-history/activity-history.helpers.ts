import type { ActivityEntityType } from '../../database/schema';

export function mapActivityHistoryResponse(event: {
  id: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  entity_type: ActivityEntityType;
  entity_id: string;
  action_type: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}) {
  return {
    id: event.id,
    actorUserId: event.actor_user_id,
    actorDisplayName: event.actor_display_name,
    entityType: event.entity_type,
    entityId: event.entity_id,
    actionType: event.action_type,
    summary: event.summary,
    metadata: event.metadata ?? {},
    timestamp: event.created_at,
  };
}
