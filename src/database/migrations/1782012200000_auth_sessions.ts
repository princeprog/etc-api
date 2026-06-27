import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('authentication.sessions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col
        .notNull()
        .references('authentication.users.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('refresh_token_hash', 'text', (col) => col.notNull())
    .addColumn('current_access_token_jti', 'uuid', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('last_rotated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('auth_sessions_user_id_idx')
    .on('authentication.sessions')
    .column('user_id')
    .execute();
  await db.schema
    .createIndex('auth_sessions_expires_at_idx')
    .on('authentication.sessions')
    .column('expires_at')
    .execute();
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('auth_sessions_expires_at_idx')
    .ifExists()
    .execute();
  await db.schema.dropIndex('auth_sessions_user_id_idx').ifExists().execute();
  await db.schema.dropTable('authentication.sessions').ifExists().execute();
}
