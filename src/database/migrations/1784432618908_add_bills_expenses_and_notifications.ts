import { sql, type Kysely } from 'kysely';

const EXPENSE_CATEGORY_SEED = [
  {
    name: 'Rent',
    description: 'Land rental, parking space, and property-related bills.',
  },
  {
    name: 'Utilities',
    description: 'Electricity, water, and other utility services.',
  },
  {
    name: 'Internet / Communication',
    description: 'Internet, telephone, load, and communication expenses.',
  },
  {
    name: 'Allowances',
    description: 'Staff allowance, meal allowance, and operating allowance.',
  },
  {
    name: 'Cleaning / Supplies',
    description: 'Soap, cleaning supplies, and dealership consumables.',
  },
  {
    name: 'Maintenance',
    description: 'Facility, equipment, and office maintenance expenses.',
  },
  {
    name: 'Office Supplies',
    description: 'Stationery, printing, and administrative supplies.',
  },
  {
    name: 'Payroll-related',
    description: 'Payroll-adjacent expenses not tracked as commissions.',
  },
  {
    name: 'Other',
    description: 'Operating expenses that do not fit another category.',
  },
];

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('finance').ifNotExists().execute();
  await db.schema.createSchema('ops').ifNotExists().execute();

  await db.schema
    .createTable('finance.expense_categories')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('name', 'varchar(128)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('is_default', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('finance.expense_recurring_rules')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('category_id', 'uuid', (col) =>
      col
        .notNull()
        .references('finance.expense_categories.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('expected_amount', sql`numeric(12,2)`, (col) => col.notNull())
    .addColumn('frequency', 'varchar(16)', (col) => col.notNull())
    .addColumn('due_day', 'integer', (col) => col.notNull())
    .addColumn('start_date', 'date', (col) => col.notNull())
    .addColumn('end_date', 'date')
    .addColumn('vendor_name', 'varchar(255)')
    .addColumn('assigned_staff_id', 'uuid', (col) =>
      col
        .references('authentication.users.id')
        .onDelete('set null')
        .onUpdate('cascade'),
    )
    .addColumn('notes', 'text')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_by_user_id', 'uuid', (col) =>
      col
        .notNull()
        .references('authentication.users.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('updated_by_user_id', 'uuid', (col) =>
      col
        .references('authentication.users.id')
        .onDelete('set null')
        .onUpdate('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('finance.expenses')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('recurring_rule_id', 'uuid', (col) =>
      col
        .references('finance.expense_recurring_rules.id')
        .onDelete('set null')
        .onUpdate('cascade'),
    )
    .addColumn('billing_period_key', 'varchar(32)')
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('category_id', 'uuid', (col) =>
      col
        .notNull()
        .references('finance.expense_categories.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('expected_amount', sql`numeric(12,2)`, (col) => col.notNull())
    .addColumn('actual_paid_amount', sql`numeric(12,2)`)
    .addColumn('expense_date', 'date')
    .addColumn('due_date', 'date', (col) => col.notNull())
    .addColumn('paid_at', 'timestamptz')
    .addColumn('status', 'varchar(16)', (col) =>
      col.notNull().defaultTo('unpaid'),
    )
    .addColumn('vendor_name', 'varchar(255)')
    .addColumn('assigned_staff_id', 'uuid', (col) =>
      col
        .references('authentication.users.id')
        .onDelete('set null')
        .onUpdate('cascade'),
    )
    .addColumn('payment_method', 'varchar(64)')
    .addColumn('reference_number', 'varchar(128)')
    .addColumn('notes', 'text')
    .addColumn('voided_at', 'timestamptz')
    .addColumn('void_reason', 'text')
    .addColumn('created_by_user_id', 'uuid', (col) =>
      col
        .notNull()
        .references('authentication.users.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('updated_by_user_id', 'uuid', (col) =>
      col
        .references('authentication.users.id')
        .onDelete('set null')
        .onUpdate('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('ops.notifications')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('recipient_user_id', 'uuid', (col) =>
      col
        .notNull()
        .references('authentication.users.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('type', 'varchar(64)', (col) => col.notNull())
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('entity_type', 'varchar(64)', (col) => col.notNull())
    .addColumn('entity_id', 'uuid', (col) => col.notNull())
    .addColumn('due_date_snapshot', 'date')
    .addColumn('deduplication_key', 'varchar(255)', (col) =>
      col.notNull().unique(),
    )
    .addColumn('read_at', 'timestamptz')
    .addColumn('resolved_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    alter table finance.expense_categories
    add constraint expense_categories_name_not_blank
    check (length(trim(name)) > 0)
  `.execute(db);
  await sql`
    alter table finance.expense_recurring_rules
    add constraint expense_recurring_rules_expected_amount_non_negative
    check (expected_amount >= 0)
  `.execute(db);
  await sql`
    alter table finance.expense_recurring_rules
    add constraint expense_recurring_rules_frequency_check
    check (frequency in ('weekly', 'monthly', 'yearly'))
  `.execute(db);
  await sql`
    alter table finance.expense_recurring_rules
    add constraint expense_recurring_rules_due_day_check
    check (due_day between 1 and 31)
  `.execute(db);
  await sql`
    alter table finance.expense_recurring_rules
    add constraint expense_recurring_rules_date_range_check
    check (end_date is null or end_date >= start_date)
  `.execute(db);
  await sql`
    alter table finance.expenses
    add constraint expenses_expected_amount_non_negative
    check (expected_amount >= 0)
  `.execute(db);
  await sql`
    alter table finance.expenses
    add constraint expenses_actual_paid_amount_non_negative
    check (actual_paid_amount is null or actual_paid_amount >= 0)
  `.execute(db);
  await sql`
    alter table finance.expenses
    add constraint expenses_status_check
    check (status in ('unpaid', 'paid', 'void'))
  `.execute(db);
  await sql`
    alter table finance.expenses
    add constraint expenses_paid_fields_check
    check (
      (status = 'paid' and paid_at is not null and actual_paid_amount is not null)
      or (status <> 'paid' and paid_at is null and actual_paid_amount is null)
    )
  `.execute(db);
  await sql`
    alter table finance.expenses
    add constraint expenses_void_fields_check
    check (
      (status = 'void' and voided_at is not null)
      or (status <> 'void' and voided_at is null)
    )
  `.execute(db);
  await sql`
    alter table finance.expenses
    add constraint expenses_recurring_period_check
    check (
      (recurring_rule_id is null and billing_period_key is null)
      or (recurring_rule_id is not null and billing_period_key is not null)
    )
  `.execute(db);
  await sql`
    alter table ops.notifications
    add constraint notifications_type_check
    check (type in ('expense_due_soon', 'expense_due_today', 'expense_overdue'))
  `.execute(db);

  await sql`
    create unique index expense_categories_name_unique_idx
    on finance.expense_categories (lower(name))
  `.execute(db);
  await sql`
    create unique index expenses_recurring_rule_period_unique_idx
    on finance.expenses (recurring_rule_id, billing_period_key)
    where recurring_rule_id is not null
  `.execute(db);

  await db.schema
    .createIndex('expense_recurring_rules_category_idx')
    .on('finance.expense_recurring_rules')
    .column('category_id')
    .execute();
  await db.schema
    .createIndex('expense_recurring_rules_assigned_staff_idx')
    .on('finance.expense_recurring_rules')
    .column('assigned_staff_id')
    .execute();
  await db.schema
    .createIndex('expense_recurring_rules_active_start_idx')
    .on('finance.expense_recurring_rules')
    .columns(['is_active', 'start_date'])
    .execute();
  await db.schema
    .createIndex('expenses_category_idx')
    .on('finance.expenses')
    .column('category_id')
    .execute();
  await db.schema
    .createIndex('expenses_assigned_staff_idx')
    .on('finance.expenses')
    .column('assigned_staff_id')
    .execute();
  await db.schema
    .createIndex('expenses_due_status_idx')
    .on('finance.expenses')
    .columns(['due_date', 'status'])
    .execute();
  await db.schema
    .createIndex('expenses_recurring_rule_idx')
    .on('finance.expenses')
    .column('recurring_rule_id')
    .execute();
  await db.schema
    .createIndex('notifications_recipient_created_idx')
    .on('ops.notifications')
    .columns(['recipient_user_id', 'created_at'])
    .execute();
  await db.schema
    .createIndex('notifications_recipient_unread_idx')
    .on('ops.notifications')
    .columns(['recipient_user_id', 'read_at', 'resolved_at'])
    .execute();
  await db.schema
    .createIndex('notifications_entity_idx')
    .on('ops.notifications')
    .columns(['entity_type', 'entity_id'])
    .execute();

  await db
    .insertInto('finance.expense_categories')
    .values(
      EXPENSE_CATEGORY_SEED.map((category) => ({
        ...category,
        is_default: true,
      })),
    )
    .execute();
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('notifications_entity_idx').ifExists().execute();
  await db.schema
    .dropIndex('notifications_recipient_unread_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('notifications_recipient_created_idx')
    .ifExists()
    .execute();
  await db.schema.dropIndex('expenses_recurring_rule_idx').ifExists().execute();
  await db.schema.dropIndex('expenses_due_status_idx').ifExists().execute();
  await db.schema.dropIndex('expenses_assigned_staff_idx').ifExists().execute();
  await db.schema.dropIndex('expenses_category_idx').ifExists().execute();
  await db.schema
    .dropIndex('expense_recurring_rules_active_start_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('expense_recurring_rules_assigned_staff_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('expense_recurring_rules_category_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('expenses_recurring_rule_period_unique_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('expense_categories_name_unique_idx')
    .ifExists()
    .execute();

  await db.schema.dropTable('ops.notifications').ifExists().execute();
  await db.schema.dropTable('finance.expenses').ifExists().execute();
  await db.schema
    .dropTable('finance.expense_recurring_rules')
    .ifExists()
    .execute();
  await db.schema.dropTable('finance.expense_categories').ifExists().execute();
  await db.schema.dropSchema('finance').ifExists().execute();
}
