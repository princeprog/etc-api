import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('authentication').ifNotExists().execute();

  await db.schema
    .createTable('authentication.roles')
    .addColumn('id', 'uuid', (col) =>
      col.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn('name', 'varchar(120)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('is_system', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('is_mutable', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('archived_at', 'timestamptz')
    .addColumn('created_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('updated_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('revision', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('authentication.permissions')
    .addColumn('key', 'varchar(120)', (col) => col.primaryKey())
    .addColumn('module', 'varchar(80)', (col) => col.notNull())
    .addColumn('action', 'varchar(80)', (col) => col.notNull())
    .addColumn('label', 'varchar(160)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('supports_assigned_scope', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('sort_order', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('authentication.role_permissions')
    .addColumn('role_id', 'uuid', (col) =>
      col
        .notNull()
        .references('authentication.roles.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('permission_key', 'varchar(120)', (col) =>
      col
        .notNull()
        .references('authentication.permissions.key')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('scope', 'varchar(24)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint('role_permissions_pkey', [
      'role_id',
      'permission_key',
    ])
    .addCheckConstraint(
      'role_permissions_scope_check',
      sql`scope in ('assigned', 'all')`,
    )
    .execute();

  await sql`
    create unique index roles_active_name_unique_idx
      on authentication.roles (lower(name))
      where archived_at is null
  `.execute(db);

  await db.schema
    .createIndex('role_permissions_permission_idx')
    .on('authentication.role_permissions')
    .column('permission_key')
    .execute();

  await seedPermissions(db);
  await seedRoles(db);

  await db.schema
    .alterTable('authentication.users')
    .addColumn('role_id', 'uuid', (col) =>
      col.references('authentication.roles.id').onDelete('restrict'),
    )
    .execute();

  await sql`
    update authentication.users users
    set role_id = roles.id
    from authentication.roles roles
    where
      (users.role = 'admin' and roles.name = 'Administrator')
      or (users.role <> 'admin' and roles.name = 'Staff')
  `.execute(db);

  await sql`
    alter table authentication.users
    alter column role_id set not null
  `.execute(db);

  await db.schema
    .createIndex('users_role_id_idx')
    .on('authentication.users')
    .column('role_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('authentication.users_role_id_idx').ifExists().execute();

  await db.schema
    .alterTable('authentication.users')
    .dropColumn('role_id')
    .execute();

  await db.schema
    .dropIndex('authentication.role_permissions_permission_idx')
    .ifExists()
    .execute();
  await sql`drop index if exists authentication.roles_active_name_unique_idx`.execute(
    db,
  );
  await db.schema
    .dropTable('authentication.role_permissions')
    .ifExists()
    .execute();
  await db.schema.dropTable('authentication.permissions').ifExists().execute();
  await db.schema.dropTable('authentication.roles').ifExists().execute();
}

async function seedPermissions(db: Kysely<any>): Promise<void> {
  await sql`
    insert into authentication.permissions (
      key,
      module,
      action,
      label,
      description,
      supports_assigned_scope,
      sort_order
    )
    values
      ('dashboard.view', 'Dashboard', 'view', 'View dashboard', 'Access dealership dashboard metrics.', true, 10),
      ('seller_leads.view', 'Seller leads', 'view', 'View seller leads', 'Open seller lead records.', true, 20),
      ('seller_leads.create', 'Seller leads', 'create', 'Create seller leads', 'Add new seller lead records.', false, 30),
      ('seller_leads.update', 'Seller leads', 'update', 'Edit seller leads', 'Update seller lead details and assignment.', true, 40),
      ('seller_leads.delete', 'Seller leads', 'delete', 'Delete seller leads', 'Remove seller lead records when supported.', true, 50),
      ('seller_leads.convert', 'Seller leads', 'workflow', 'Convert seller leads', 'Convert approved seller leads into vehicles.', true, 60),
      ('buyer_leads.view', 'Buyer leads', 'view', 'View buyer leads', 'Open buyer lead records.', true, 70),
      ('buyer_leads.create', 'Buyer leads', 'create', 'Create buyer leads', 'Add new buyer lead records.', false, 80),
      ('buyer_leads.update', 'Buyer leads', 'update', 'Edit buyer leads', 'Update buyer lead details and assignment.', true, 90),
      ('buyer_leads.delete', 'Buyer leads', 'delete', 'Delete buyer leads', 'Remove buyer lead records when supported.', true, 100),
      ('vehicles.view', 'Vehicles', 'view', 'View vehicles', 'Access vehicle inventory records.', false, 110),
      ('vehicles.create', 'Vehicles', 'create', 'Create vehicles', 'Add vehicles to inventory.', false, 120),
      ('vehicles.update', 'Vehicles', 'update', 'Edit vehicles', 'Update vehicle information and pricing.', false, 130),
      ('vehicles.delete', 'Vehicles', 'delete', 'Delete vehicles', 'Remove vehicle records when supported.', false, 140),
      ('vehicle_catalog.manage', 'Settings', 'manage', 'Manage vehicle catalog', 'Configure brand, model, and variant options.', false, 150),
      ('inspection_checklists.manage', 'Settings', 'manage', 'Manage inspection checklist', 'Configure the dealership inspection checklist.', false, 160),
      ('inspections.view', 'Inspections', 'view', 'View inspections', 'Open seller lead inspection records.', true, 170),
      ('inspections.update', 'Inspections', 'update', 'Edit inspections', 'Save inspection drafts and completed inspections.', true, 180),
      ('follow_ups.view', 'Follow-ups', 'view', 'View follow-ups', 'Access follow-up queues and records.', true, 190),
      ('follow_ups.create', 'Follow-ups', 'create', 'Create follow-ups', 'Schedule new follow-ups.', true, 200),
      ('follow_ups.update', 'Follow-ups', 'update', 'Edit follow-ups', 'Complete, cancel, or update follow-ups.', true, 210),
      ('sales.view', 'Sales', 'view', 'View sales', 'Access sales and draft sale records.', true, 220),
      ('sales.create', 'Sales', 'create', 'Create sales', 'Create sale drafts and finalized transactions.', false, 230),
      ('sales.update', 'Sales', 'update', 'Edit sales', 'Update sale drafts and finalize transactions.', true, 240),
      ('reports.view', 'Reports', 'view', 'View reports', 'Open operational and sales reports.', false, 250),
      ('expense_reports.view', 'Expenses', 'view', 'View expense reports', 'Open expense analytics and exports.', false, 260),
      ('expenses.view', 'Expenses', 'view', 'View expenses', 'Open bill and expense records.', true, 270),
      ('expenses.create', 'Expenses', 'create', 'Create expenses', 'Record bills and recurring expense rules.', false, 280),
      ('expenses.update', 'Expenses', 'update', 'Edit expenses', 'Mark bills paid, upload receipts, void bills, and update rules.', true, 290),
      ('expense_categories.manage', 'Settings', 'manage', 'Manage expense categories', 'Configure expense category options.', false, 300),
      ('activity_history.view', 'Activity', 'view', 'View activity history', 'Review audit trail events.', false, 310),
      ('users.manage', 'Administration', 'manage', 'Manage users', 'Create users and update account status.', false, 320),
      ('roles.manage', 'Administration', 'manage', 'Manage roles', 'Create roles and configure role access levels.', false, 330)
  `.execute(db);
}

async function seedRoles(db: Kysely<any>): Promise<void> {
  await sql`
    insert into authentication.roles (
      name,
      description,
      is_system,
      is_mutable
    )
    values
      ('Administrator', 'Full system access. This protected role cannot be edited or archived.', true, false),
      ('Staff', 'Default operational staff access.', true, true)
  `.execute(db);

  await sql`
    insert into authentication.role_permissions (role_id, permission_key, scope)
    select roles.id, permissions.key, 'all'
    from authentication.roles roles
    cross join authentication.permissions permissions
    where roles.name = 'Administrator'
  `.execute(db);

  await sql`
    insert into authentication.role_permissions (role_id, permission_key, scope)
    select
      roles.id,
      permissions.key,
      case
        when permissions.supports_assigned_scope then 'assigned'
        else 'all'
      end
    from authentication.roles roles
    join authentication.permissions permissions on permissions.key in (
      'dashboard.view',
      'seller_leads.view',
      'seller_leads.create',
      'seller_leads.update',
      'seller_leads.convert',
      'buyer_leads.view',
      'buyer_leads.create',
      'buyer_leads.update',
      'vehicles.view',
      'inspections.view',
      'inspections.update',
      'follow_ups.view',
      'follow_ups.create',
      'follow_ups.update',
      'sales.view',
      'sales.create',
      'sales.update',
      'expenses.view',
      'expenses.update',
      'reports.view'
    )
    where roles.name = 'Staff'
  `.execute(db);
}
