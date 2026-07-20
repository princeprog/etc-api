import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('crm.follow_ups')
    .addColumn('cancelled_at', 'timestamptz')
    .addColumn('cancellation_reason', 'text')
    .execute();

  await sql`
    with ranked as (
      select
        id,
        row_number() over (
          partition by buyer_lead_id
          order by created_at desc, id desc
        ) as row_number
      from crm.follow_ups
      where
        buyer_lead_id is not null
        and completed_at is null
        and cancelled_at is null
    )
    update crm.follow_ups as follow_up
    set
      status = 'Cancelled',
      cancelled_at = now(),
      cancellation_reason = 'Cancelled by migration because a newer active buyer lead follow-up exists.',
      updated_at = now()
    from ranked
    where follow_up.id = ranked.id and ranked.row_number > 1
  `.execute(db);

  await sql`
    with ranked as (
      select
        id,
        row_number() over (
          partition by seller_lead_id
          order by created_at desc, id desc
        ) as row_number
      from crm.follow_ups
      where
        seller_lead_id is not null
        and completed_at is null
        and cancelled_at is null
    )
    update crm.follow_ups as follow_up
    set
      status = 'Cancelled',
      cancelled_at = now(),
      cancellation_reason = 'Cancelled by migration because a newer active seller lead follow-up exists.',
      updated_at = now()
    from ranked
    where follow_up.id = ranked.id and ranked.row_number > 1
  `.execute(db);

  await sql`
    create unique index follow_ups_active_buyer_lead_unique
      on crm.follow_ups (buyer_lead_id)
      where buyer_lead_id is not null
        and completed_at is null
        and cancelled_at is null
  `.execute(db);

  await sql`
    create unique index follow_ups_active_seller_lead_unique
      on crm.follow_ups (seller_lead_id)
      where seller_lead_id is not null
        and completed_at is null
        and cancelled_at is null
  `.execute(db);
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop index if exists crm.follow_ups_active_seller_lead_unique`.execute(
    db,
  );
  await sql`drop index if exists crm.follow_ups_active_buyer_lead_unique`.execute(
    db,
  );

  await db.schema
    .alterTable('crm.follow_ups')
    .dropColumn('cancellation_reason')
    .dropColumn('cancelled_at')
    .execute();
}
