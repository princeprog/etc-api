import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('sales.sales')
    .addColumn('sale_number', 'varchar(32)')
    .execute();

  await sql`
		with numbered_sales as (
			select
				id,
				'S-' || extract(year from sale_date)::text || '-' ||
				lpad(
					row_number() over (
						partition by extract(year from sale_date)
						order by sale_date asc, created_at asc, id asc
					)::text,
					3,
					'0'
				) as generated_sale_number
			from sales.sales
		)
		update sales.sales as sales
		set sale_number = numbered_sales.generated_sale_number
		from numbered_sales
		where sales.id = numbered_sales.id
	`.execute(db);

  await db.schema
    .alterTable('sales.sales')
    .alterColumn('sale_number', (col) => col.setNotNull())
    .execute();

  await db.schema
    .createIndex('sales_sale_number_unique_idx')
    .on('sales.sales')
    .column('sale_number')
    .unique()
    .execute();
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('sales_sale_number_unique_idx')
    .ifExists()
    .execute();

  await db.schema.alterTable('sales.sales').dropColumn('sale_number').execute();
}
