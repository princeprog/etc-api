import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('finance.financing_requirements')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('label', 'varchar(160)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('is_required', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
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

  await sql`
    insert into finance.financing_requirements (
      label,
      description,
      is_required,
      sort_order,
      created_by_user_id,
      updated_by_user_id
    )
    select
      item.label,
      item.description,
      item.is_required,
      row_number() over (
        order by template.is_default desc, template.created_at desc, item.sort_order, item.created_at
      ) - 1,
      template.created_by_user_id,
      template.updated_by_user_id
    from finance.financing_requirement_template_items item
    join finance.financing_requirement_templates template
      on template.id = item.template_id
    where template.is_active = true
      and template.id = (
        select selected_template.id
        from finance.financing_requirement_templates selected_template
        where selected_template.is_active = true
        order by selected_template.is_default desc, selected_template.created_at desc
        limit 1
      )
    order by item.sort_order, item.created_at
  `.execute(db);

  await db.schema
    .alterTable('finance.financing_applications')
    .alterColumn('partner_id', (col) => col.dropNotNull())
    .alterColumn('template_id', (col) => col.dropNotNull())
    .execute();

  await db.schema
    .createIndex('financing_requirements_active_sort_idx')
    .on('finance.financing_requirements')
    .columns(['is_active', 'sort_order'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('finance.financing_requirements_active_sort_idx')
    .ifExists()
    .execute();

  await sql`
    update finance.financing_applications
    set
      partner_id = coalesce(
        partner_id,
        (
          select id
          from finance.financing_partners
          where is_active = true
          order by created_at asc
          limit 1
        )
      ),
      template_id = coalesce(
        template_id,
        (
          select id
          from finance.financing_requirement_templates
          where is_active = true
          order by is_default desc, created_at desc
          limit 1
        )
      )
  `.execute(db);

  await db.schema
    .alterTable('finance.financing_applications')
    .alterColumn('partner_id', (col) => col.setNotNull())
    .alterColumn('template_id', (col) => col.dropNotNull())
    .execute();

  await db.schema.dropTable('finance.financing_requirements').execute();
}
