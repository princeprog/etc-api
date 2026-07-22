import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('crm').ifNotExists().execute();

  await db.schema
    .createTable('crm.inspection_templates')
    .addColumn('id', 'uuid', (col) =>
      col.defaultTo(db.fn('gen_random_uuid')).primaryKey(),
    )
    .addColumn('name', 'varchar(160)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('is_default', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('archived_at', 'timestamptz')
    .addColumn('created_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('updated_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(db.fn('now')),
    )
    .execute();

  await db.schema
    .createTable('crm.inspection_template_versions')
    .addColumn('id', 'uuid', (col) =>
      col.defaultTo(db.fn('gen_random_uuid')).primaryKey(),
    )
    .addColumn('template_id', 'uuid', (col) =>
      col
        .notNull()
        .references('crm.inspection_templates.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('version_number', 'integer', (col) => col.notNull())
    .addColumn('status', 'varchar(24)', (col) => col.notNull())
    .addColumn('published_at', 'timestamptz')
    .addColumn('published_by_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(db.fn('now')),
    )
    .addCheckConstraint(
      'inspection_template_versions_status_check',
      sql`status in ('draft', 'published')`,
    )
    .execute();

  await db.schema
    .createTable('crm.inspection_template_sections')
    .addColumn('id', 'uuid', (col) =>
      col.defaultTo(db.fn('gen_random_uuid')).primaryKey(),
    )
    .addColumn('template_version_id', 'uuid', (col) =>
      col
        .notNull()
        .references('crm.inspection_template_versions.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('label', 'varchar(160)', (col) => col.notNull())
    .addColumn('sort_order', 'integer', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .execute();

  await db.schema
    .createTable('crm.inspection_template_items')
    .addColumn('id', 'uuid', (col) =>
      col.defaultTo(db.fn('gen_random_uuid')).primaryKey(),
    )
    .addColumn('template_section_id', 'uuid', (col) =>
      col
        .notNull()
        .references('crm.inspection_template_sections.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('stable_key', 'varchar(120)', (col) => col.notNull())
    .addColumn('label', 'varchar(200)', (col) => col.notNull())
    .addColumn('finding_key', 'varchar(64)')
    .addColumn('is_required', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('sort_order', 'integer', (col) => col.notNull())
    .execute();

  await db.schema
    .createTable('crm.seller_lead_inspections')
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
    .addColumn('template_version_id', 'uuid', (col) =>
      col
        .references('crm.inspection_template_versions.id')
        .onDelete('set null')
        .onUpdate('cascade'),
    )
    .addColumn('template_snapshot', 'jsonb', (col) => col.notNull())
    .addColumn('answers', 'jsonb', (col) => col.notNull())
    .addColumn('major_issues', 'text')
    .addColumn('recommended_repairs', 'text')
    .addColumn('inspector_notes', 'text')
    .addColumn('estimated_repair_cost', sql`numeric(12,2)`)
    .addColumn('overall_condition', 'varchar(24)', (col) => col.notNull())
    .addColumn('status', 'varchar(24)', (col) => col.notNull())
    .addColumn('completed_at', 'timestamptz')
    .addColumn('inspector_user_id', 'uuid', (col) =>
      col.references('authentication.users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(db.fn('now')),
    )
    .addCheckConstraint(
      'seller_lead_inspections_condition_check',
      sql`overall_condition in ('good', 'fair', 'poor')`,
    )
    .addCheckConstraint(
      'seller_lead_inspections_status_check',
      sql`status in ('draft', 'completed')`,
    )
    .execute();

  await sql`
    create unique index inspection_templates_one_default_idx
      on crm.inspection_templates (is_default)
      where is_default = true and archived_at is null
  `.execute(db);
  await db.schema
    .createIndex('inspection_template_versions_template_idx')
    .on('crm.inspection_template_versions')
    .column('template_id')
    .execute();
  await sql`
    create unique index inspection_template_versions_one_draft_idx
      on crm.inspection_template_versions (template_id)
      where status = 'draft'
  `.execute(db);
  await sql`
    create unique index inspection_template_versions_number_idx
      on crm.inspection_template_versions (template_id, version_number)
  `.execute(db);
  await db.schema
    .createIndex('inspection_template_sections_version_idx')
    .on('crm.inspection_template_sections')
    .column('template_version_id')
    .execute();
  await db.schema
    .createIndex('inspection_template_items_section_idx')
    .on('crm.inspection_template_items')
    .column('template_section_id')
    .execute();
  await sql`
    create unique index inspection_template_items_stable_key_idx
      on crm.inspection_template_items (template_section_id, stable_key)
  `.execute(db);
  await sql`
    create unique index seller_lead_inspections_lead_idx
      on crm.seller_lead_inspections (seller_lead_id)
  `.execute(db);
  await db.schema
    .createIndex('seller_lead_inspections_template_version_idx')
    .on('crm.seller_lead_inspections')
    .column('template_version_id')
    .execute();

  await sql`
    with template as (
      insert into crm.inspection_templates (name, description, is_default)
      values (
        'Default Vehicle Inspection',
        'Baseline ETC Cars vehicle inspection checklist.',
        true
      )
      returning id
    ),
    version as (
      insert into crm.inspection_template_versions (
        template_id,
        version_number,
        status,
        published_at
      )
      select id, 1, 'published', now()
      from template
      returning id
    ),
    seeded_sections as (
      select *
      from (values
        ('exterior', 'Exterior', 1),
        ('interior', 'Interior', 2),
        ('mechanical', 'Engine and Mechanical', 3),
        ('tires', 'Tires and Wheels', 4),
        ('electrical', 'Electrical System', 5),
        ('documents', 'Documents and Identification', 6),
        ('road-test', 'Road Test', 7)
      ) as s(stable_key, label, sort_order)
    ),
    inserted_sections as (
      insert into crm.inspection_template_sections (
        template_version_id,
        label,
        sort_order,
        is_active
      )
      select version.id, seeded_sections.label, seeded_sections.sort_order, true
      from version
      cross join seeded_sections
      returning id, label
    ),
    seeded_items as (
      select *
      from (values
        ('Exterior', 'body-paint', 'Body panels and paint', 'exterior', 1),
        ('Exterior', 'glass', 'Windshield and windows', 'exterior', 2),
        ('Exterior', 'exterior-lights', 'Headlights and signal lights', 'electrical', 3),
        ('Exterior', 'mirrors', 'Mirrors', 'exterior', 4),
        ('Exterior', 'doors', 'Doors, hood, and tailgate', 'exterior', 5),
        ('Interior', 'seats', 'Seats and upholstery', 'interior', 1),
        ('Interior', 'dashboard', 'Dashboard and trim', 'interior', 2),
        ('Interior', 'controls', 'Interior controls', 'interior', 3),
        ('Interior', 'seatbelts', 'Seatbelts and safety equipment', 'interior', 4),
        ('Interior', 'odor', 'Cabin odor and water damage', 'interior', 5),
        ('Interior', 'storage', 'Storage and cargo area', 'interior', 6),
        ('Interior', 'headliner', 'Headliner and floor covering', 'interior', 7),
        ('Engine and Mechanical', 'engine-start', 'Engine start and idle', 'engine', 1),
        ('Engine and Mechanical', 'fluids', 'Fluid levels and condition', 'engine', 2),
        ('Engine and Mechanical', 'leaks', 'Visible leaks', 'engine', 3),
        ('Engine and Mechanical', 'cooling', 'Cooling system', 'engine', 4),
        ('Engine and Mechanical', 'transmission', 'Transmission operation', 'transmission', 5),
        ('Engine and Mechanical', 'clutch', 'Clutch and driveline', 'transmission', 6),
        ('Engine and Mechanical', 'suspension', 'Suspension components', 'suspension', 7),
        ('Engine and Mechanical', 'steering', 'Steering system', 'suspension', 8),
        ('Engine and Mechanical', 'brakes', 'Brakes and brake fluid', 'brakes', 9),
        ('Engine and Mechanical', 'exhaust', 'Exhaust and emissions', 'engine', 10),
        ('Tires and Wheels', 'front-tires', 'Front tire condition', 'tires', 1),
        ('Tires and Wheels', 'rear-tires', 'Rear tire condition', 'tires', 2),
        ('Tires and Wheels', 'wheels', 'Wheels and alignment', 'tires', 3),
        ('Tires and Wheels', 'spare', 'Spare tire and tools', 'tires', 4),
        ('Electrical System', 'battery', 'Battery and charging', 'electrical', 1),
        ('Electrical System', 'warning-lights', 'Dashboard warning lights', 'electrical', 2),
        ('Electrical System', 'power-features', 'Power windows, locks, and mirrors', 'electrical', 3),
        ('Electrical System', 'air-conditioning', 'Air conditioning', 'ac', 4),
        ('Electrical System', 'audio', 'Audio and infotainment', 'electrical', 5),
        ('Documents and Identification', 'registration', 'Registration documents', 'papers', 1),
        ('Documents and Identification', 'vin', 'Chassis and VIN verification', 'papers', 2),
        ('Documents and Identification', 'engine-number', 'Engine number verification', 'papers', 3),
        ('Documents and Identification', 'service-records', 'Service and ownership records', 'papers', 4),
        ('Road Test', 'acceleration', 'Acceleration and engine response', 'engine', 1),
        ('Road Test', 'road-shifting', 'Gear shifting and drivability', 'transmission', 2),
        ('Road Test', 'road-handling', 'Braking, steering, and handling', 'brakes', 3)
      ) as i(section_label, stable_key, label, finding_key, sort_order)
    )
    insert into crm.inspection_template_items (
      template_section_id,
      stable_key,
      label,
      finding_key,
      is_required,
      is_active,
      sort_order
    )
    select
      inserted_sections.id,
      seeded_items.stable_key,
      seeded_items.label,
      seeded_items.finding_key,
      true,
      true,
      seeded_items.sort_order
    from seeded_items
    join inserted_sections on inserted_sections.label = seeded_items.section_label
  `.execute(db);

  await sql`
    with default_version as (
      select itv.id
      from crm.inspection_template_versions itv
      join crm.inspection_templates it on it.id = itv.template_id
      where it.is_default = true and itv.status = 'published'
      limit 1
    ),
    snapshot as (
      select
        default_version.id as template_version_id,
        jsonb_build_object(
          'templateName', 'Default Vehicle Inspection',
          'versionNumber', 1,
          'sections',
          jsonb_agg(
            jsonb_build_object(
              'id', section_rows.id,
              'label', section_rows.label,
              'sortOrder', section_rows.sort_order,
              'isActive', section_rows.is_active,
              'items', section_rows.items
            )
            order by section_rows.sort_order
          )
        ) as template_snapshot
      from default_version
      join (
        select
          its.template_version_id,
          its.id,
          its.label,
          its.sort_order,
          its.is_active,
          jsonb_agg(
            jsonb_build_object(
              'id', iti.id,
              'stableKey', iti.stable_key,
              'label', iti.label,
              'findingKey', iti.finding_key,
              'isRequired', iti.is_required,
              'isActive', iti.is_active,
              'sortOrder', iti.sort_order
            )
            order by iti.sort_order
          ) as items
        from crm.inspection_template_sections its
        join crm.inspection_template_items iti on iti.template_section_id = its.id
        group by its.template_version_id, its.id
      ) section_rows on section_rows.template_version_id = default_version.id
      group by default_version.id
    )
    insert into crm.seller_lead_inspections (
      seller_lead_id,
      template_version_id,
      template_snapshot,
      answers,
      inspector_notes,
      overall_condition,
      status,
      completed_at,
      created_at,
      updated_at
    )
    select
      sl.id,
      snapshot.template_version_id,
      snapshot.template_snapshot,
      '{}'::jsonb,
      case
        when sl.inspection_notes like '[[seller-lead-inspection:v1]]%' then null
        else sl.inspection_notes
      end,
      'fair',
      case when sl.inspection_completed_at is null then 'draft' else 'completed' end,
      sl.inspection_completed_at,
      sl.created_at,
      sl.updated_at
    from crm.seller_leads sl
    cross join snapshot
    where sl.inspection_completed_at is not null
       or sl.inspection_notes is not null
       or sl.inspection_findings is not null
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('crm.seller_lead_inspections').ifExists().execute();
  await db.schema
    .dropTable('crm.inspection_template_items')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('crm.inspection_template_sections')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('crm.inspection_template_versions')
    .ifExists()
    .execute();
  await db.schema.dropTable('crm.inspection_templates').ifExists().execute();
}
