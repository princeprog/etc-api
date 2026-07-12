import type { Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('inventory.vehicle_brands')
    .addColumn('archived_at', 'timestamptz')
    .execute();

  await db.schema
    .alterTable('inventory.vehicle_models')
    .addColumn('archived_at', 'timestamptz')
    .execute();

  await db.schema
    .alterTable('inventory.vehicle_variants')
    .addColumn('archived_at', 'timestamptz')
    .execute();
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('inventory.vehicle_variants')
    .dropColumn('archived_at')
    .execute();

  await db.schema
    .alterTable('inventory.vehicle_models')
    .dropColumn('archived_at')
    .execute();

  await db.schema
    .alterTable('inventory.vehicle_brands')
    .dropColumn('archived_at')
    .execute();
}
