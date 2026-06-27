import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`create extension if not exists pgcrypto`.execute(db);
  await db.schema.createSchema('authentication').ifNotExists().execute();
  await db.schema.createSchema('crm').ifNotExists().execute();
  await db.schema.createSchema('inventory').ifNotExists().execute();
  await db.schema.createSchema('sales').ifNotExists().execute();

  await db.schema
    .createTable('authentication.users')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('full_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('role', 'varchar(32)', (col) => col.notNull())
    .addColumn('active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('crm.seller_leads')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('seller_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('contact_number', 'varchar(32)', (col) => col.notNull())
    .addColumn('email', 'varchar(255)')
    .addColumn('facebook_name', 'varchar(255)')
    .addColumn('inquiry_source', 'varchar(128)')
    .addColumn('vehicle_brand', 'varchar(128)', (col) => col.notNull())
    .addColumn('vehicle_model', 'varchar(128)', (col) => col.notNull())
    .addColumn('vehicle_year', 'integer')
    .addColumn('vehicle_variant', 'varchar(128)')
    .addColumn('asking_price', sql`numeric(12,2)`)
    .addColumn('region', 'varchar(128)')
    .addColumn('notes', 'text')
    .addColumn('status', 'varchar(32)', (col) => col.notNull())
    .addColumn('assignee_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null').onUpdate('cascade'),
    )
    .addColumn('latest_activity_at', 'timestamptz')
    .addColumn('closing_note', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('crm.buyer_leads')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('buyer_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('contact_number', 'varchar(32)', (col) => col.notNull())
    .addColumn('email', 'varchar(255)')
    .addColumn('facebook_name', 'varchar(255)')
    .addColumn('inquiry_source', 'varchar(128)')
    .addColumn('desired_budget', sql`numeric(12,2)`)
    .addColumn('notes', 'text')
    .addColumn('status', 'varchar(32)', (col) => col.notNull())
    .addColumn('assignee_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null').onUpdate('cascade'),
    )
    .addColumn('latest_activity_at', 'timestamptz')
    .addColumn('closing_note', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('inventory.vehicles')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('stock_number', 'varchar(64)', (col) => col.notNull().unique())
    .addColumn('brand', 'varchar(128)', (col) => col.notNull())
    .addColumn('model', 'varchar(128)', (col) => col.notNull())
    .addColumn('year', 'integer', (col) => col.notNull())
    .addColumn('variant', 'varchar(128)')
    .addColumn('mileage', 'integer')
    .addColumn('transmission', 'varchar(64)')
    .addColumn('fuel_type', 'varchar(64)')
    .addColumn('color', 'varchar(64)')
    .addColumn('region', 'varchar(128)')
    .addColumn('features', 'text')
    .addColumn('remarks', 'text')
    .addColumn('purchase_price', sql`numeric(12,2)`)
    .addColumn('target_selling_price', sql`numeric(12,2)`)
    .addColumn('minimum_acceptable_price', sql`numeric(12,2)`)
    .addColumn('acquisition_source', 'varchar(128)')
    .addColumn('seller_lead_id', 'uuid', (col) =>
      col
        .references('crm.seller_leads.id')
        .onDelete('set null')
        .onUpdate('cascade'),
    )
    .addColumn('status', 'varchar(32)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('inventory.vehicle_photos')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('vehicle_id', 'uuid', (col) =>
      col
        .notNull()
        .references('inventory.vehicles.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('file_url', 'text', (col) => col.notNull())
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('crm.lead_vehicle_links')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('buyer_lead_id', 'uuid', (col) =>
      col
        .notNull()
        .references('crm.buyer_leads.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('vehicle_id', 'uuid', (col) =>
      col
        .notNull()
        .references('inventory.vehicles.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('lead_vehicle_links_buyer_vehicle_unique', [
      'buyer_lead_id',
      'vehicle_id',
    ])
    .execute();

  await db.schema
    .createTable('crm.lead_activities')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('lead_type', 'varchar(16)', (col) => col.notNull())
    .addColumn('seller_lead_id', 'uuid', (col) =>
      col
        .references('crm.seller_leads.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('buyer_lead_id', 'uuid', (col) =>
      col
        .references('crm.buyer_leads.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('activity_type', 'varchar(64)', (col) => col.notNull())
    .addColumn('note', 'text', (col) => col.notNull())
    .addColumn('performed_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null').onUpdate('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('crm.follow_ups')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('lead_type', 'varchar(16)', (col) => col.notNull())
    .addColumn('seller_lead_id', 'uuid', (col) =>
      col
        .references('crm.seller_leads.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('buyer_lead_id', 'uuid', (col) =>
      col
        .references('crm.buyer_leads.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('assignee_user_id', 'uuid', (col) =>
      col
        .notNull()
        .references('authentication.users.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('due_at', 'timestamptz', (col) => col.notNull())
    .addColumn('completed_at', 'timestamptz')
    .addColumn('status', 'varchar(16)', (col) => col.notNull())
    .addColumn('note', 'text', (col) => col.notNull())
    .addColumn('outcome_note', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('sales.sales')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('vehicle_id', 'uuid', (col) =>
      col
        .notNull()
        .references('inventory.vehicles.id')
        .onDelete('restrict')
        .onUpdate('cascade')
        .unique(),
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
    .addColumn('sale_date', 'date', (col) => col.notNull())
    .addColumn('final_sale_amount', sql`numeric(12,2)`, (col) => col.notNull())
    .addColumn('gross_profit_amount', sql`numeric(12,2)`)
    .addColumn('commission_method', 'varchar(64)')
    .addColumn('commission_locked', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('sales.commissions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('sale_id', 'uuid', (col) =>
      col
        .notNull()
        .references('sales.sales.id')
        .onDelete('cascade')
        .onUpdate('cascade')
        .unique(),
    )
    .addColumn('agent_name', 'varchar(255)')
    .addColumn('default_amount', sql`numeric(12,2)`)
    .addColumn('override_amount', sql`numeric(12,2)`)
    .addColumn('final_amount', sql`numeric(12,2)`, (col) => col.notNull())
    .addColumn('override_reason', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('seller_leads_assignee_idx')
    .on('crm.seller_leads')
    .column('assignee_user_id')
    .execute();
  await db.schema
    .createIndex('buyer_leads_assignee_idx')
    .on('crm.buyer_leads')
    .column('assignee_user_id')
    .execute();
  await db.schema
    .createIndex('vehicles_seller_lead_idx')
    .on('inventory.vehicles')
    .column('seller_lead_id')
    .execute();
  await db.schema
    .createIndex('vehicle_photos_vehicle_idx')
    .on('inventory.vehicle_photos')
    .column('vehicle_id')
    .execute();
  await db.schema
    .createIndex('lead_activities_seller_lead_idx')
    .on('crm.lead_activities')
    .column('seller_lead_id')
    .execute();
  await db.schema
    .createIndex('lead_activities_buyer_lead_idx')
    .on('crm.lead_activities')
    .column('buyer_lead_id')
    .execute();
  await db.schema
    .createIndex('follow_ups_assignee_idx')
    .on('crm.follow_ups')
    .column('assignee_user_id')
    .execute();
  await db.schema
    .createIndex('follow_ups_due_at_idx')
    .on('crm.follow_ups')
    .column('due_at')
    .execute();
  await db.schema
    .createIndex('follow_ups_seller_lead_idx')
    .on('crm.follow_ups')
    .column('seller_lead_id')
    .execute();
  await db.schema
    .createIndex('follow_ups_buyer_lead_idx')
    .on('crm.follow_ups')
    .column('buyer_lead_id')
    .execute();
  await db.schema
    .createIndex('sales_buyer_lead_idx')
    .on('sales.sales')
    .column('buyer_lead_id')
    .execute();
  await db.schema
    .createIndex('sales_created_by_idx')
    .on('sales.sales')
    .column('created_by_user_id')
    .execute();
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('sales_created_by_idx').ifExists().execute();
  await db.schema.dropIndex('sales_buyer_lead_idx').ifExists().execute();
  await db.schema.dropIndex('follow_ups_buyer_lead_idx').ifExists().execute();
  await db.schema.dropIndex('follow_ups_seller_lead_idx').ifExists().execute();
  await db.schema.dropIndex('follow_ups_due_at_idx').ifExists().execute();
  await db.schema.dropIndex('follow_ups_assignee_idx').ifExists().execute();
  await db.schema
    .dropIndex('lead_activities_buyer_lead_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('lead_activities_seller_lead_idx')
    .ifExists()
    .execute();
  await db.schema.dropIndex('vehicle_photos_vehicle_idx').ifExists().execute();
  await db.schema.dropIndex('vehicles_seller_lead_idx').ifExists().execute();
  await db.schema.dropIndex('buyer_leads_assignee_idx').ifExists().execute();
  await db.schema.dropIndex('seller_leads_assignee_idx').ifExists().execute();

  await db.schema.dropTable('sales.commissions').ifExists().execute();
  await db.schema.dropTable('sales.sales').ifExists().execute();
  await db.schema.dropTable('crm.follow_ups').ifExists().execute();
  await db.schema.dropTable('crm.lead_activities').ifExists().execute();
  await db.schema.dropTable('crm.lead_vehicle_links').ifExists().execute();
  await db.schema.dropTable('inventory.vehicle_photos').ifExists().execute();
  await db.schema.dropTable('inventory.vehicles').ifExists().execute();
  await db.schema.dropTable('crm.buyer_leads').ifExists().execute();
  await db.schema.dropTable('crm.seller_leads').ifExists().execute();
  await db.schema.dropTable('authentication.users').ifExists().execute();
  await db.schema.dropSchema('sales').ifExists().execute();
  await db.schema.dropSchema('inventory').ifExists().execute();
  await db.schema.dropSchema('crm').ifExists().execute();
  await db.schema.dropSchema('authentication').ifExists().execute();
}
