import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('crm.seller_leads')
    .addColumn('inspection_completed_at', 'timestamptz')
    .addColumn('inspection_notes', 'text')
    .addColumn('inspection_findings', 'jsonb')
    .addColumn('target_buy_price', sql`numeric(12,2)`)
    .addColumn('expected_resale_price', sql`numeric(12,2)`)
    .addColumn('target_profit_amount', sql`numeric(12,2)`)
    .addColumn('decision', 'varchar(32)')
    .addColumn('decision_note', 'text')
    .addColumn('approved_to_buy_at', 'timestamptz')
    .addColumn('approved_by_user_id', 'uuid', (col) =>
      col
        .references('authentication.users.id')
        .onDelete('set null')
        .onUpdate('cascade'),
    )
    .execute();

  await db.schema
    .createTable('crm.seller_lead_estimated_costs')
    .addColumn('id', 'uuid', (col) =>
      col.defaultTo(db.fn('gen_random_uuid')).primaryKey(),
    )
    .addColumn('seller_lead_id', 'uuid', (col) =>
      col
        .notNull()
        .references('crm.seller_leads.id')
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
    .createIndex('seller_lead_estimated_costs_lead_idx')
    .on('crm.seller_lead_estimated_costs')
    .column('seller_lead_id')
    .execute();

  await db.schema
    .createIndex('seller_leads_approved_by_idx')
    .on('crm.seller_leads')
    .column('approved_by_user_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('seller_lead_estimated_costs_lead_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('seller_leads_approved_by_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('crm.seller_lead_estimated_costs')
    .ifExists()
    .execute();
  await db.schema
    .alterTable('crm.seller_leads')
    .dropColumn('approved_by_user_id')
    .dropColumn('approved_to_buy_at')
    .dropColumn('decision_note')
    .dropColumn('decision')
    .dropColumn('target_profit_amount')
    .dropColumn('expected_resale_price')
    .dropColumn('target_buy_price')
    .dropColumn('inspection_findings')
    .dropColumn('inspection_notes')
    .dropColumn('inspection_completed_at')
    .execute();
}
