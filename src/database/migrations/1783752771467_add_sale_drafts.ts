import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('sales.sale_drafts')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('draft_number', 'varchar(32)', (col) => col.notNull().unique())
    .addColumn('vehicle_id', 'uuid', (col) =>
      col
        .notNull()
        .references('inventory.vehicles.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('buyer_lead_id', 'uuid', (col) =>
      col
        .notNull()
        .references('crm.buyer_leads.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('created_by_user_id', 'uuid', (col) =>
      col
        .notNull()
        .references('authentication.users.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('agent_name', 'varchar(255)')
    .addColumn('sale_date', 'date')
    .addColumn('final_sale_amount', sql`numeric(12,2)`)
    .addColumn('commission_override_amount', sql`numeric(12,2)`)
    .addColumn('commission_override_reason', 'text')
    .addColumn('buyer_closing_note', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('sale_drafts_vehicle_idx')
    .on('sales.sale_drafts')
    .column('vehicle_id')
    .execute();

  await db.schema
    .createIndex('sale_drafts_buyer_lead_idx')
    .on('sales.sale_drafts')
    .column('buyer_lead_id')
    .execute();

  await db.schema
    .createIndex('sale_drafts_created_by_idx')
    .on('sales.sale_drafts')
    .column('created_by_user_id')
    .execute();

  await db.schema
    .createIndex('sale_drafts_created_at_idx')
    .on('sales.sale_drafts')
    .column('created_at')
    .execute();

  await db.schema
    .createIndex('sale_drafts_user_buyer_vehicle_unique_idx')
    .on('sales.sale_drafts')
    .columns(['created_by_user_id', 'buyer_lead_id', 'vehicle_id'])
    .unique()
    .execute();
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('sale_drafts_user_buyer_vehicle_unique_idx')
    .ifExists()
    .execute();
  await db.schema.dropIndex('sale_drafts_created_at_idx').ifExists().execute();
  await db.schema.dropIndex('sale_drafts_created_by_idx').ifExists().execute();
  await db.schema.dropIndex('sale_drafts_buyer_lead_idx').ifExists().execute();
  await db.schema.dropIndex('sale_drafts_vehicle_idx').ifExists().execute();
  await db.schema.dropTable('sales.sale_drafts').ifExists().execute();
}
