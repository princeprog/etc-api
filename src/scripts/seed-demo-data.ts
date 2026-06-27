import 'dotenv/config';

import { type Insertable, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { DB } from '../database/db.js';

const SELLER_LEAD_COUNT = 20;
const BUYER_LEAD_COUNT = 20;
const VEHICLE_COUNT = 20;
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
      .selectFrom('authentication.users')
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

function buildSellerLeads(
  assigneeUserId: string | null,
  now: Date,
): Array<Insertable<DB['crm.seller_leads']>> {
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
    ['Marco Villanueva', 'Kia', 'Soluto', 2021, 'EX AT', '498000.00', 'Naga', 'Facebook'],
    ['Sheila Romero', 'Mazda', 'CX-5', 2020, '2.0 Pro', '1195000.00', 'Cebu', 'Referral'],
    ['Victor Aquino', 'Toyota', 'Hilux', 2021, 'G 4x2 AT', '1285000.00', 'Mandaue', 'Marketplace'],
    ['Anne Bautista', 'Honda', 'BR-V', 2022, 'S CVT', '848000.00', 'Liloan', 'Walk-in'],
    ['Chris Delgado', 'Nissan', 'Almera', 2023, 'VL CVT', '655000.00', 'Talisay', 'Facebook'],
    ['Patricia Yu', 'Ford', 'Everest', 2019, 'Titanium+', '1498000.00', 'Cebu', 'Referral'],
    ['Rico Mercado', 'Mitsubishi', 'Mirage G4', 2020, 'GLS CVT', '465000.00', 'Danao', 'Marketplace'],
    ['Samantha Chua', 'Suzuki', 'Dzire', 2021, 'GL+', '438000.00', 'Consolacion', 'Walk-in'],
    ['Noel Fernandez', 'Hyundai', 'Stargazer', 2023, 'GLS Premium', '958000.00', 'Minglanilla', 'Facebook'],
    ['Grace Serrano', 'Toyota', 'Innova', 2020, 'E Diesel AT', '1085000.00', 'Cebu', 'Referral'],
  ] as const;

  return samples.map(
    (
      [sellerName, brand, model, year, variant, askingPrice, region, source],
      index,
    ) => ({
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
      status:
        index < 4
          ? 'New Inquiry'
          : index < 7
            ? 'Contacted'
            : 'Inspection Scheduled',
      assignee_user_id: assigneeUserId,
      latest_activity_at: now,
      closing_note: null,
    }),
  );
}

function buildBuyerLeads(
  assigneeUserId: string | null,
  now: Date,
): Array<Insertable<DB['crm.buyer_leads']>> {
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
    ['Kyle Soriano', '760000.00', 'Automatic crossover for daily commute', 'Referral'],
    ['Liza Navarro', '590000.00', 'Reliable sedan for family use', 'Facebook'],
    ['Marlon Go', '1450000.00', 'Pickup with strong resale value', 'Marketplace'],
    ['Nica Velasco', '880000.00', '7-seater MPV with low mileage', 'Walk-in'],
    ['Owen Tan', '510000.00', 'Entry-level automatic hatchback', 'Referral'],
    ['Pam Reyes', '970000.00', 'SUV for provincial trips', 'Facebook'],
    ['Quinn Dela Cruz', '1180000.00', '4x2 pickup for small business', 'Marketplace'],
    ['Rhea Lim', '650000.00', 'Compact crossover with good fuel economy', 'Walk-in'],
    ['Sean Flores', '1390000.00', 'Diesel SUV with third-row seating', 'Referral'],
    ['Trisha Gomez', '470000.00', 'Budget-friendly city car', 'Facebook'],
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
    ['Kia', 'Soluto', 2022, 'EX AT', 'Aurora Black', 'Automatic', 'Gasoline', 11300, '445000.00', '518000.00', '495000.00', 'Incoming'],
    ['Mazda', 'CX-5', 2021, '2.0 Pro', 'Soul Red', 'Automatic', 'Gasoline', 18500, '1135000.00', '1268000.00', '1225000.00', 'Available'],
    ['Toyota', 'Hilux', 2020, 'G 4x2 AT', 'Silver Metallic', 'Automatic', 'Diesel', 27800, '1120000.00', '1265000.00', '1210000.00', 'Reserved'],
    ['Honda', 'BR-V', 2023, 'S CVT', 'Taffeta White', 'CVT', 'Gasoline', 5400, '775000.00', '858000.00', '830000.00', 'Available'],
    ['Nissan', 'Almera', 2024, 'VL CVT', 'Gun Metallic', 'CVT', 'Gasoline', 3100, '585000.00', '668000.00', '645000.00', 'Incoming'],
    ['Ford', 'Everest', 2021, 'Titanium+', 'Meteor Grey', 'Automatic', 'Diesel', 22800, '1385000.00', '1555000.00', '1495000.00', 'Reconditioning'],
    ['Mitsubishi', 'Mirage G4', 2022, 'GLS CVT', 'White Diamond', 'CVT', 'Gasoline', 9700, '418000.00', '485000.00', '462000.00', 'Available'],
    ['Suzuki', 'Dzire', 2021, 'GL+', 'Bluish Black', 'Automatic', 'Gasoline', 14500, '398000.00', '452000.00', '435000.00', 'Incoming'],
    ['Hyundai', 'Stargazer', 2023, 'GLS Premium', 'Silver', 'CVT', 'Gasoline', 6900, '835000.00', '948000.00', '918000.00', 'Available'],
    ['Toyota', 'Innova', 2020, 'E Diesel AT', 'Attitude Black', 'Automatic', 'Diesel', 26400, '965000.00', '1098000.00', '1055000.00', 'Reserved'],
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
  const message =
    error instanceof Error ? error.message : 'Unknown demo seed error';
  console.error(message);
  process.exitCode = 1;
});
