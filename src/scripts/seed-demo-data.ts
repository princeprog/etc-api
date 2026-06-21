import 'dotenv/config';

import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { DB } from '../database/db.js';

const SELLER_LEAD_COUNT = 10;
const BUYER_LEAD_COUNT = 10;
const VEHICLE_COUNT = 10;
const RESET_FLAG = '--reset';

async function seedDemoData() {
  const db = createDb();
  const shouldReset = process.argv.includes(RESET_FLAG);

  try {
    if (shouldReset) {
      await resetDemoData(db);
    }

    const [sellerLeadCount, buyerLeadCount, vehicleCount] = await Promise.all([
      getCount(db, 'crm.seller_leads'),
      getCount(db, 'crm.buyer_leads'),
      getCount(db, 'inventory.vehicles'),
    ]);

    if (sellerLeadCount > 0 || buyerLeadCount > 0 || vehicleCount > 0) {
      throw new Error(
        'Demo seed aborted because crm.seller_leads, crm.buyer_leads, or inventory.vehicles already contains data',
      );
    }

    const assigneeUser = await db
      .selectFrom('auth.users')
      .select(['id'])
      .orderBy('created_at', 'asc')
      .executeTakeFirst();

    const assigneeUserId = assigneeUser?.id ?? null;
    const now = new Date();

    const sellerLeads = buildSellerLeads(assigneeUserId, now);
    const buyerLeads = buildBuyerLeads(assigneeUserId, now);
    const vehicles = buildVehicles(now);

    await db.transaction().execute(async (trx) => {
      await trx.insertInto('crm.seller_leads').values(sellerLeads).execute();
      await trx.insertInto('crm.buyer_leads').values(buyerLeads).execute();
      await trx.insertInto('inventory.vehicles').values(vehicles).execute();
    });

    if (shouldReset) {
      console.log('Cleared existing demo-related data');
    }
    console.log(`Seeded ${SELLER_LEAD_COUNT} seller leads`);
    console.log(`Seeded ${BUYER_LEAD_COUNT} buyer leads`);
    console.log(`Seeded ${VEHICLE_COUNT} vehicles`);
  } finally {
    await db.destroy();
  }
}

async function resetDemoData(db: Kysely<DB>) {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('sales.commissions').execute();
    await trx.deleteFrom('sales.sales').execute();
    await trx.deleteFrom('crm.follow_ups').execute();
    await trx.deleteFrom('crm.lead_activities').execute();
    await trx.deleteFrom('crm.lead_vehicle_links').execute();
    await trx.deleteFrom('inventory.vehicle_photos').execute();
    await trx.deleteFrom('inventory.vehicles').execute();
    await trx.deleteFrom('crm.buyer_leads').execute();
    await trx.deleteFrom('crm.seller_leads').execute();
  });
}

function buildSellerLeads(assigneeUserId: string | null, now: Date) {
  const samples = [
    ['Ramon Bautista', 'Toyota', 'Vios', 2020, '1.3 CVT', '485000.00', 'Cebu', 'Facebook'],
    ['Jessa Flores', 'Honda', 'City', 2021, 'RS CVT', '638000.00', 'Mandaue', 'Walk-in'],
    ['Paolo Santos', 'Mitsubishi', 'Montero Sport', 2019, 'GLS AT', '968000.00', 'Lapu-Lapu', 'Referral'],
    ['Karen Dizon', 'Toyota', 'Fortuner', 2022, 'G 4x2 AT', '1580000.00', 'Cebu', 'Marketplace'],
    ['Joel Navarro', 'Ford', 'Ranger', 2020, 'Wildtrak 4x2', '1035000.00', 'Talisay', 'Facebook'],
    ['Mika Reyes', 'Nissan', 'Navara', 2021, 'VE Calibre', '925000.00', 'Cebu', 'Walk-in'],
    ['Dennis Ramos', 'Isuzu', 'mu-X', 2018, 'LS-A', '1120000.00', 'Minglanilla', 'Referral'],
    ['Lea Castillo', 'Hyundai', 'Accent', 2019, 'GLS AT', '438000.00', 'Carcar', 'Facebook'],
    ['Bryan Lim', 'Suzuki', 'Ertiga', 2022, 'GL AT', '698000.00', 'Consolacion', 'Marketplace'],
    ['Tina Gomez', 'Chevrolet', 'Trailblazer', 2020, 'LT AT', '818000.00', 'Cebu', 'Walk-in'],
  ] as const;

  return samples.map(([sellerName, brand, model, year, variant, askingPrice, region, source], index) => ({
    seller_name: sellerName,
    contact_number: `0917${String(1000000 + index).slice(-7)}`,
    email: `seller${index + 1}@example.com`,
    facebook_name: `${sellerName} Cars`,
    inquiry_source: source,
    vehicle_brand: brand,
    vehicle_model: model,
    vehicle_year: year,
    vehicle_variant: variant,
    asking_price: askingPrice,
    region,
    notes: `Demo seller lead ${index + 1} for ${brand} ${model}`,
    status: index < 4 ? 'New Inquiry' : index < 7 ? 'Contacted' : 'Inspection Scheduled',
    assignee_user_id: assigneeUserId,
    latest_activity_at: now,
    closing_note: null,
  }));
}

function buildBuyerLeads(assigneeUserId: string | null, now: Date) {
  const samples = [
    ['Alex Tan', '620000.00', 'Toyota Vios or Honda City', 'Facebook'],
    ['Bianca Cruz', '850000.00', 'MPV for family use', 'Walk-in'],
    ['Carlo Medina', '1550000.00', 'SUV diesel automatic', 'Referral'],
    ['Dianne Uy', '720000.00', 'First car daily driver', 'Marketplace'],
    ['Ethan Ong', '980000.00', 'Pickup for business', 'Facebook'],
    ['Faith Salazar', '540000.00', 'Compact sedan AT', 'Walk-in'],
    ['Gian Torres', '1280000.00', '7-seater SUV', 'Referral'],
    ['Hazel Mendoza', '430000.00', 'Fuel efficient hatchback', 'Marketplace'],
    ['Ivan Co', '1100000.00', 'Mid-size pickup', 'Facebook'],
    ['Janelle Perez', '680000.00', 'City driving crossover', 'Walk-in'],
  ] as const;

  return samples.map(([buyerName, desiredBudget, note, source], index) => ({
    buyer_name: buyerName,
    contact_number: `0998${String(2000000 + index).slice(-7)}`,
    email: `buyer${index + 1}@example.com`,
    facebook_name: `${buyerName} FB`,
    inquiry_source: source,
    desired_budget: desiredBudget,
    notes: note,
    status: index < 4 ? 'New Inquiry' : index < 7 ? 'Contacted' : 'Interested',
    assignee_user_id: assigneeUserId,
    latest_activity_at: now,
    closing_note: null,
  }));
}

function buildVehicles(now: Date) {
  const year = now.getUTCFullYear();
  const samples = [
    ['Toyota', 'Vios', 2021, 'XLE CVT', 'Pearl White', 'Automatic', 'Gasoline', 18500, '535000.00', '598000.00', '575000.00', 'Available'],
    ['Honda', 'City', 2020, 'RS CVT', 'Meteoroid Gray', 'CVT', 'Gasoline', 24100, '610000.00', '688000.00', '660000.00', 'Incoming'],
    ['Toyota', 'Fortuner', 2022, 'G 4x2 AT', 'Black', 'Automatic', 'Diesel', 12400, '1420000.00', '1580000.00', '1520000.00', 'Available'],
    ['Ford', 'Ranger', 2021, 'Wildtrak 4x2', 'Blue Lightning', 'Automatic', 'Diesel', 29800, '965000.00', '1095000.00', '1050000.00', 'Reserved'],
    ['Mitsubishi', 'Montero Sport', 2019, 'GLS Premium', 'Silver', 'Automatic', 'Diesel', 33200, '880000.00', '995000.00', '960000.00', 'Reconditioning'],
    ['Nissan', 'Navara', 2022, 'VE Calibre', 'White', 'Automatic', 'Diesel', 15300, '905000.00', '1025000.00', '995000.00', 'Incoming'],
    ['Suzuki', 'Ertiga', 2023, 'GL AT', 'Gray', 'Automatic', 'Gasoline', 8600, '625000.00', '718000.00', '690000.00', 'Available'],
    ['Hyundai', 'Accent', 2020, 'GLS', 'Red', 'Automatic', 'Gasoline', 40250, '395000.00', '455000.00', '430000.00', 'Incoming'],
    ['Isuzu', 'mu-X', 2021, 'LS-A', 'Titanium Silver', 'Automatic', 'Diesel', 21600, '1210000.00', '1365000.00', '1310000.00', 'Reserved'],
    ['Chevrolet', 'Trailblazer', 2019, 'LT', 'Summit White', 'Automatic', 'Diesel', 35500, '735000.00', '838000.00', '810000.00', 'Available'],
  ] as const;

  return samples.map(
    (
      [
        brand,
        model,
        vehicleYear,
        variant,
        color,
        transmission,
        fuelType,
        mileage,
        purchasePrice,
        targetSellingPrice,
        minimumAcceptablePrice,
        status,
      ],
      index,
    ) => ({
      stock_number: `ETC-${year}-${String(index + 1).padStart(3, '0')}`,
      brand,
      model,
      year: vehicleYear,
      variant,
      mileage,
      transmission,
      fuel_type: fuelType,
      color,
      region: index % 2 === 0 ? 'Cebu' : 'Mandaue',
      features: 'Seeded demo inventory record',
      remarks: `Demo vehicle ${index + 1}`,
      purchase_price: purchasePrice,
      target_selling_price: targetSellingPrice,
      minimum_acceptable_price: minimumAcceptablePrice,
      acquisition_source: index % 2 === 0 ? 'Walk-in' : 'Facebook',
      seller_lead_id: null,
      status,
    }),
  );
}

async function getCount(
  db: Kysely<DB>,
  tableName: 'crm.seller_leads' | 'crm.buyer_leads' | 'inventory.vehicles',
) {
  const result = await db
    .selectFrom(tableName)
    .select(({ fn }) => fn.count<string>('id').as('count'))
    .executeTakeFirstOrThrow();

  return Number(result.count);
}

function createDb() {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({
        host: requireEnv('DB_HOST'),
        port: Number(requireEnv('DB_PORT')),
        user: requireEnv('DB_USER'),
        password: requireEnv('DB_PASSWORD'),
        database: requireEnv('DB_NAME'),
      }),
    }),
  });
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

seedDemoData().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown demo seed error';
  console.error(message);
  process.exitCode = 1;
});
