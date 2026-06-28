import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    alter table ops.activity_history
    drop constraint if exists activity_history_actor_user_id_fkey
  `.execute(db);

  await sql`
    alter table ops.activity_history
    add constraint activity_history_actor_user_id_fkey
    foreign key (actor_user_id)
    references authentication.users(id)
    on delete set null
    on update cascade
  `.execute(db);
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    alter table ops.activity_history
    drop constraint if exists activity_history_actor_user_id_fkey
  `.execute(db);

  await sql`
    alter table ops.activity_history
    add constraint activity_history_actor_user_id_fkey
    foreign key (actor_user_id)
    references auth.users(id)
    on delete set null
    on update cascade
  `.execute(db);
}
