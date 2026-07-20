import { sql, type Kysely } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    create or replace function ops.broadcast_notification_realtime_change()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      target_notification_id uuid;
      target_recipient_user_id uuid;
    begin
      if tg_op = 'DELETE' then
        target_notification_id := old.id;
        target_recipient_user_id := old.recipient_user_id;
      else
        target_notification_id := new.id;
        target_recipient_user_id := new.recipient_user_id;
      end if;

      perform realtime.send(
        jsonb_build_object(
          'notificationId', target_notification_id,
          'operation', tg_op
        ),
        'notification.changed',
        'notifications:' || target_recipient_user_id::text,
        true
      );

      return coalesce(new, old);
    end;
    $$;
  `.execute(db)

  await sql`
    revoke all on function ops.broadcast_notification_realtime_change()
    from public, anon, authenticated;
  `.execute(db)

  await sql`
    drop trigger if exists notifications_realtime_broadcast_trigger
    on ops.notifications;
  `.execute(db)

  await sql`
    create trigger notifications_realtime_broadcast_trigger
    after insert or update or delete on ops.notifications
    for each row
    execute function ops.broadcast_notification_realtime_change();
  `.execute(db)

  await sql`
    do $$
    begin
      if not exists (
        select 1
        from pg_policies
        where schemaname = 'realtime'
          and tablename = 'messages'
          and policyname = 'users can receive own notification broadcasts'
      ) then
        create policy "users can receive own notification broadcasts"
        on realtime.messages
        for select
        to authenticated
        using (
          extension = 'broadcast'
          and realtime.topic() = 'notifications:' || (select auth.uid())::text
        );
      end if;
    end;
    $$;
  `.execute(db)
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    drop trigger if exists notifications_realtime_broadcast_trigger
    on ops.notifications;
  `.execute(db)

  await sql`
    drop function if exists ops.broadcast_notification_realtime_change();
  `.execute(db)

  await sql`
    drop policy if exists "users can receive own notification broadcasts"
    on realtime.messages;
  `.execute(db)
}
