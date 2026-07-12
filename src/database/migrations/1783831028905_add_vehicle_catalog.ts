import { sql, type Kysely } from 'kysely';

const VEHICLE_CATALOG_SEED = [
  {
    brand: 'Toyota',
    models: [
      'Vios',
      'Wigo',
      'Fortuner',
      'Hilux',
      'Innova',
      'Avanza',
      'Raize',
      'Rush',
      'Corolla Altis',
    ],
  },
  {
    brand: 'Mitsubishi',
    models: ['Mirage G4', 'Xpander', 'Montero Sport', 'Strada', 'L300'],
  },
  {
    brand: 'Honda',
    models: ['City', 'Civic', 'BR-V', 'CR-V', 'HR-V', 'Brio'],
  },
  {
    brand: 'Nissan',
    models: ['Almera', 'Navara', 'Terra', 'Kicks'],
  },
  {
    brand: 'Ford',
    models: ['Ranger', 'Everest', 'Territory', 'EcoSport'],
  },
  {
    brand: 'Hyundai',
    models: ['Stargazer', 'Accent', 'Tucson', 'Santa Fe'],
  },
  {
    brand: 'Kia',
    models: ['Soluto', 'Seltos', 'Stonic', 'Carnival'],
  },
  {
    brand: 'Suzuki',
    models: ['Dzire', 'Ertiga', 'Jimny', 'Swift', 'S-Presso'],
  },
  {
    brand: 'Mazda',
    models: ['Mazda2', 'Mazda3', 'CX-5', 'CX-8', 'BT-50'],
  },
  {
    brand: 'Isuzu',
    models: ['D-Max', 'mu-X', 'Traviz'],
  },
  {
    brand: 'Chevrolet',
    models: ['Trailblazer', 'Spark', 'Colorado'],
  },
  {
    brand: 'MG',
    models: ['ZS', 'HS', '5'],
  },
  {
    brand: 'Geely',
    models: ['Coolray', 'Okavango', 'Emgrand'],
  },
];

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('inventory').ifNotExists().execute();

  await db.schema
    .createTable('inventory.vehicle_brands')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('name', 'varchar(128)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('inventory.vehicle_models')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('brand_id', 'uuid', (col) =>
      col
        .notNull()
        .references('inventory.vehicle_brands.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('name', 'varchar(128)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable('inventory.vehicle_variants')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('model_id', 'uuid', (col) =>
      col
        .notNull()
        .references('inventory.vehicle_models.id')
        .onDelete('cascade')
        .onUpdate('cascade'),
    )
    .addColumn('name', 'varchar(128)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    create unique index vehicle_brands_name_unique_idx
    on inventory.vehicle_brands (lower(name))
  `.execute(db);
  await sql`
    create unique index vehicle_models_brand_name_unique_idx
    on inventory.vehicle_models (brand_id, lower(name))
  `.execute(db);
  await sql`
    create unique index vehicle_variants_model_name_unique_idx
    on inventory.vehicle_variants (model_id, lower(name))
  `.execute(db);

  await db.schema
    .createIndex('vehicle_models_brand_idx')
    .on('inventory.vehicle_models')
    .column('brand_id')
    .execute();
  await db.schema
    .createIndex('vehicle_variants_model_idx')
    .on('inventory.vehicle_variants')
    .column('model_id')
    .execute();

  for (const seed of VEHICLE_CATALOG_SEED) {
    const brand = await db
      .insertInto('inventory.vehicle_brands')
      .values({ name: seed.brand })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    await db
      .insertInto('inventory.vehicle_models')
      .values(
        seed.models.map((model) => ({
          // Migrations use Kysely<any> so the returned id is intentionally untyped here.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          brand_id: brand.id,
          name: model,
        })),
      )
      .execute();
  }
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('vehicle_variants_model_idx').ifExists().execute();
  await db.schema.dropIndex('vehicle_models_brand_idx').ifExists().execute();
  await db.schema
    .dropIndex('vehicle_variants_model_name_unique_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('vehicle_models_brand_name_unique_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('vehicle_brands_name_unique_idx')
    .ifExists()
    .execute();

  await db.schema.dropTable('inventory.vehicle_variants').ifExists().execute();
  await db.schema.dropTable('inventory.vehicle_models').ifExists().execute();
  await db.schema.dropTable('inventory.vehicle_brands').ifExists().execute();
}
