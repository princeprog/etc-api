import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('ops').ifNotExists().execute();

  await db.schema
    .createTable('ops.activity_history')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('actor_user_id', 'uuid', (col) =>
      col
        .references('authentication.users.id')
        .onDelete('set null')
        .onUpdate('cascade'),
    )
    .addColumn('actor_display_name', 'varchar(255)')
    .addColumn('entity_type', 'varchar(32)', (col) => col.notNull())
    .addColumn('entity_id', 'uuid', (col) => col.notNull())
    .addColumn('action_type', 'varchar(128)', (col) => col.notNull())
    .addColumn('summary', 'varchar(512)', (col) => col.notNull())
    .addColumn('metadata', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('activity_history_entity_created_idx')
    .on('ops.activity_history')
    .columns(['entity_type', 'entity_id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('activity_history_entity_created_idx').ifExists().execute();
  await db.schema.dropTable('ops.activity_history').ifExists().execute();
  await db.schema.dropSchema('ops').ifExists().execute();
}
