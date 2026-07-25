import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('finance').ifNotExists().execute();

  await db.schema
    .createTable('finance.financing_partners')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('name', 'varchar(160)', (col) => col.notNull())
    .addColumn('contact_person', 'varchar(160)')
    .addColumn('contact_number', 'varchar(64)')
    .addColumn('email', 'varchar(255)')
    .addColumn('notes', 'text')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('updated_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('finance.financing_partner_representatives')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('partner_id', 'uuid', (col) =>
      col
        .notNull()
        .references('finance.financing_partners.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col
        .notNull()
        .references('authentication.users.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('financing_partner_reps_partner_user_unique', [
      'partner_id',
      'user_id',
    ])
    .execute();

  await db.schema
    .createTable('finance.financing_requirement_templates')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('partner_id', 'uuid', (col) =>
      col
        .notNull()
        .references('finance.financing_partners.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('name', 'varchar(160)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('is_default', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('updated_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('finance.financing_requirement_template_items')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('template_id', 'uuid', (col) =>
      col
        .notNull()
        .references('finance.financing_requirement_templates.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('label', 'varchar(160)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('is_required', 'boolean', (col) =>
      col.notNull().defaultTo(true),
    )
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('finance.financing_applications')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('application_number', 'varchar(32)', (col) =>
      col.notNull().unique(),
    )
    .addColumn('buyer_lead_id', 'uuid', (col) =>
      col
        .notNull()
        .references('crm.buyer_leads.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('vehicle_id', 'uuid', (col) =>
      col
        .notNull()
        .references('inventory.vehicles.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('assigned_staff_user_id', 'uuid', (col) =>
      col
        .notNull()
        .references('authentication.users.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('partner_id', 'uuid', (col) =>
      col
        .notNull()
        .references('finance.financing_partners.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('representative_user_id', 'uuid', (col) =>
      col
        .notNull()
        .references('authentication.users.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('template_id', 'uuid', (col) =>
      col
        .references('finance.financing_requirement_templates.id')
        .onDelete('set null')
        .onUpdate('cascade'),
    )
    .addColumn('status', 'varchar(40)', (col) =>
      col.notNull().defaultTo('draft'),
    )
    .addColumn('requested_amount', sql`numeric(12,2)`)
    .addColumn('down_payment', sql`numeric(12,2)`)
    .addColumn('term_months', 'integer')
    .addColumn('decision_note', 'text')
    .addColumn('decided_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('decided_at', 'timestamptz')
    .addColumn('released_loan_amount', sql`numeric(12,2)`)
    .addColumn('loan_released_at', 'timestamptz')
    .addColumn('loan_release_reference', 'varchar(160)')
    .addColumn('loan_released_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('vehicle_released_at', 'timestamptz')
    .addColumn('vehicle_release_note', 'text')
    .addColumn('vehicle_released_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('cancelled_at', 'timestamptz')
    .addColumn('cancelled_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('cancellation_reason', 'text')
    .addColumn('created_by_user_id', 'uuid', (col) =>
      col
        .notNull()
        .references('authentication.users.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .addColumn('updated_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'financing_applications_status_check',
      sql`status in ('draft', 'collecting_requirements', 'under_review', 'needs_revision', 'approved', 'rejected', 'loan_released', 'vehicle_released', 'cancelled')`,
    )
    .execute();

  await db.schema
    .createTable('finance.financing_application_requirements')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('application_id', 'uuid', (col) =>
      col
        .notNull()
        .references('finance.financing_applications.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('template_item_id', 'uuid')
    .addColumn('label', 'varchar(160)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('is_required', 'boolean', (col) =>
      col.notNull().defaultTo(true),
    )
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('status', 'varchar(40)', (col) =>
      col.notNull().defaultTo('pending'),
    )
    .addColumn('revision_reason', 'text')
    .addColumn('review_note', 'text')
    .addColumn('reviewed_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('reviewed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'financing_requirements_status_check',
      sql`status in ('pending', 'submitted', 'accepted', 'revision_requested')`,
    )
    .execute();

  await db.schema
    .createTable('finance.financing_document_versions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('requirement_id', 'uuid', (col) =>
      col
        .notNull()
        .references('finance.financing_application_requirements.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('version_number', 'integer', (col) => col.notNull())
    .addColumn('file_public_id', 'text', (col) => col.notNull())
    .addColumn('file_resource_type', 'varchar(32)', (col) =>
      col.notNull().defaultTo('raw'),
    )
    .addColumn('original_filename', 'varchar(255)', (col) => col.notNull())
    .addColumn('mime_type', 'varchar(120)', (col) => col.notNull())
    .addColumn('file_size', 'integer', (col) => col.notNull())
    .addColumn('is_current', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('uploaded_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('uploaded_by_public_session_id', 'uuid')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('financing_doc_versions_requirement_version_unique', [
      'requirement_id',
      'version_number',
    ])
    .execute();

  await db.schema
    .createTable('finance.financing_upload_links')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('application_id', 'uuid', (col) =>
      col
        .notNull()
        .references('finance.financing_applications.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('token_hash', 'varchar(64)', (col) => col.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('finance.financing_upload_verification_attempts')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('upload_link_id', 'uuid', (col) =>
      col
        .notNull()
        .references('finance.financing_upload_links.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('ip_address', 'varchar(96)', (col) => col.notNull())
    .addColumn('succeeded', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .alterTable('sales.sale_drafts')
    .addColumn('payment_mode', 'varchar(24)', (col) =>
      col.notNull().defaultTo('cash'),
    )
    .addColumn('financing_application_id', 'uuid', (col) =>
      col
        .references('finance.financing_applications.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .execute();

  await db.schema
    .alterTable('sales.sales')
    .addColumn('payment_mode', 'varchar(24)', (col) =>
      col.notNull().defaultTo('cash'),
    )
    .addColumn('financing_application_id', 'uuid', (col) =>
      col
        .references('finance.financing_applications.id')
        .onDelete('restrict')
        .onUpdate('cascade'),
    )
    .execute();

  await sql`
    create unique index financing_partners_active_name_unique_idx
      on finance.financing_partners (lower(name))
      where is_active = true
  `.execute(db);
  await sql`
    create unique index financing_templates_default_partner_unique_idx
      on finance.financing_requirement_templates (partner_id)
      where is_default = true and is_active = true
  `.execute(db);
  await sql`
    create unique index financing_applications_active_buyer_vehicle_unique_idx
      on finance.financing_applications (buyer_lead_id, vehicle_id)
      where status not in ('rejected', 'vehicle_released', 'cancelled')
  `.execute(db);
  await sql`
    create unique index financing_current_documents_unique_idx
      on finance.financing_document_versions (requirement_id)
      where is_current = true
  `.execute(db);
  await sql`
    create unique index financing_upload_links_active_application_unique_idx
      on finance.financing_upload_links (application_id)
      where revoked_at is null
  `.execute(db);

  await db.schema
    .createIndex('financing_partner_reps_user_idx')
    .on('finance.financing_partner_representatives')
    .column('user_id')
    .execute();
  await db.schema
    .createIndex('financing_templates_partner_idx')
    .on('finance.financing_requirement_templates')
    .column('partner_id')
    .execute();
  await db.schema
    .createIndex('financing_template_items_template_idx')
    .on('finance.financing_requirement_template_items')
    .column('template_id')
    .execute();
  await db.schema
    .createIndex('financing_applications_status_idx')
    .on('finance.financing_applications')
    .column('status')
    .execute();
  await db.schema
    .createIndex('financing_applications_staff_idx')
    .on('finance.financing_applications')
    .column('assigned_staff_user_id')
    .execute();
  await db.schema
    .createIndex('financing_applications_rep_idx')
    .on('finance.financing_applications')
    .column('representative_user_id')
    .execute();
  await db.schema
    .createIndex('financing_app_requirements_application_idx')
    .on('finance.financing_application_requirements')
    .column('application_id')
    .execute();
  await db.schema
    .createIndex('financing_doc_versions_requirement_idx')
    .on('finance.financing_document_versions')
    .column('requirement_id')
    .execute();
  await db.schema
    .createIndex('financing_upload_links_application_idx')
    .on('finance.financing_upload_links')
    .column('application_id')
    .execute();
  await db.schema
    .createIndex('financing_upload_attempts_link_created_idx')
    .on('finance.financing_upload_verification_attempts')
    .columns(['upload_link_id', 'created_at'])
    .execute();
  await db.schema
    .createIndex('sale_drafts_financing_application_idx')
    .on('sales.sale_drafts')
    .column('financing_application_id')
    .execute();
  await db.schema
    .createIndex('sales_financing_application_idx')
    .on('sales.sales')
    .column('financing_application_id')
    .execute();

  await seedFinancingPermissions(db);
  await seedFinancingRoles(db);
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    delete from authentication.role_permissions
    where permission_key like 'financing.%'
  `.execute(db);
  await sql`
    delete from authentication.roles
    where name = 'Financing Representative'
  `.execute(db);
  await sql`
    delete from authentication.permissions
    where key like 'financing.%'
  `.execute(db);

  await db.schema.dropIndex('sales.sales_financing_application_idx').ifExists().execute();
  await db.schema
    .dropIndex('sales.sale_drafts_financing_application_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('finance.financing_upload_attempts_link_created_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('finance.financing_upload_links_application_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('finance.financing_doc_versions_requirement_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('finance.financing_app_requirements_application_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('finance.financing_applications_rep_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('finance.financing_applications_staff_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('finance.financing_applications_status_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('finance.financing_template_items_template_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('finance.financing_templates_partner_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('finance.financing_partner_reps_user_idx')
    .ifExists()
    .execute();
  await sql`drop index if exists finance.financing_upload_links_active_application_unique_idx`.execute(
    db,
  );
  await sql`drop index if exists finance.financing_current_documents_unique_idx`.execute(
    db,
  );
  await sql`drop index if exists finance.financing_applications_active_buyer_vehicle_unique_idx`.execute(
    db,
  );
  await sql`drop index if exists finance.financing_templates_default_partner_unique_idx`.execute(
    db,
  );
  await sql`drop index if exists finance.financing_partners_active_name_unique_idx`.execute(
    db,
  );

  await db.schema
    .alterTable('sales.sales')
    .dropColumn('financing_application_id')
    .dropColumn('payment_mode')
    .execute();
  await db.schema
    .alterTable('sales.sale_drafts')
    .dropColumn('financing_application_id')
    .dropColumn('payment_mode')
    .execute();

  await db.schema
    .dropTable('finance.financing_upload_verification_attempts')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('finance.financing_upload_links')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('finance.financing_document_versions')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('finance.financing_application_requirements')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('finance.financing_applications')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('finance.financing_requirement_template_items')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('finance.financing_requirement_templates')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('finance.financing_partner_representatives')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('finance.financing_partners')
    .ifExists()
    .execute();
}

async function seedFinancingPermissions(db: Kysely<any>): Promise<void> {
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
      ('financing.view', 'Financing', 'view', 'View financing applications', 'Open financing applications and their requirement checklist.', true, 340),
      ('financing.create', 'Financing', 'create', 'Create financing applications', 'Start financing applications for buyer leads and vehicles.', false, 350),
      ('financing.update', 'Financing', 'update', 'Edit financing applications', 'Update application assignments, loan request details, and upload links.', true, 360),
      ('financing.review', 'Financing', 'review', 'Review financing requirements', 'Accept submitted requirements or request buyer revisions.', true, 370),
      ('financing.decide', 'Financing', 'decide', 'Decide financing applications', 'Approve or reject financing applications.', true, 380),
      ('financing.record_loan_release', 'Financing', 'workflow', 'Record loan release', 'Record released loan amount, date, and reference.', true, 390),
      ('financing.record_vehicle_release', 'Financing', 'workflow', 'Record vehicle release', 'Record the physical vehicle release after sale finalization.', true, 400),
      ('financing.manage_partners', 'Financing', 'manage', 'Manage financing partners', 'Create and update financing partners and representative memberships.', false, 410),
      ('financing.manage_templates', 'Financing', 'manage', 'Manage financing templates', 'Create and update financing requirement templates.', false, 420)
    on conflict (key) do update set
      module = excluded.module,
      action = excluded.action,
      label = excluded.label,
      description = excluded.description,
      supports_assigned_scope = excluded.supports_assigned_scope,
      sort_order = excluded.sort_order
  `.execute(db);
}

async function seedFinancingRoles(db: Kysely<any>): Promise<void> {
  await sql`
    insert into authentication.roles (
      name,
      description,
      is_system,
      is_mutable
    )
    values (
      'Financing Representative',
      'Partner representative access limited to assigned financing applications.',
      true,
      true
    )
    on conflict do nothing
  `.execute(db);

  await sql`
    insert into authentication.role_permissions (role_id, permission_key, scope)
    select roles.id, permissions.key, 'all'
    from authentication.roles roles
    join authentication.permissions permissions on permissions.key like 'financing.%'
    where roles.name = 'Administrator'
    on conflict (role_id, permission_key) do update set scope = excluded.scope
  `.execute(db);

  await sql`
    insert into authentication.role_permissions (role_id, permission_key, scope)
    select roles.id, permissions.key, 'assigned'
    from authentication.roles roles
    join authentication.permissions permissions on permissions.key in (
      'financing.view',
      'financing.create',
      'financing.update',
      'financing.record_vehicle_release'
    )
    where roles.name = 'Staff'
    on conflict (role_id, permission_key) do update set scope = excluded.scope
  `.execute(db);

  await sql`
    insert into authentication.role_permissions (role_id, permission_key, scope)
    select roles.id, permissions.key, 'assigned'
    from authentication.roles roles
    join authentication.permissions permissions on permissions.key in (
      'financing.view',
      'financing.review',
      'financing.decide',
      'financing.record_loan_release'
    )
    where roles.name = 'Financing Representative'
    on conflict (role_id, permission_key) do update set scope = excluded.scope
  `.execute(db);
}
