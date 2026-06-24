import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('inventory.vehicle_tracked_costs')
    .addColumn('id', 'uuid', (col) =>
      col.defaultTo(db.fn('gen_random_uuid')).primaryKey(),
    )
    .addColumn('vehicle_id', 'uuid', (col) =>
      col
        .notNull()
        .references('inventory.vehicles.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('category', 'varchar(64)', (col) => col.notNull())
    .addColumn('amount', sql`numeric(12,2)`, (col) => col.notNull())
    .addColumn('note', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(db.fn('now')),
    )
    .execute();

  await db.schema
    .createIndex('vehicle_tracked_costs_vehicle_idx')
    .on('inventory.vehicle_tracked_costs')
    .column('vehicle_id')
    .execute();
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('vehicle_tracked_costs_vehicle_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('inventory.vehicle_tracked_costs')
    .ifExists()
    .execute();
}
