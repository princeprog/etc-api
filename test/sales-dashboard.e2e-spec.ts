import 'dotenv/config';

import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common/utils/auth.utils';
import { DATABASE } from '../src/database/database.constants';
import type { DB } from '../src/database/db';

const ADMIN_EMAIL = 'sales.admin@example.com';
const PASSWORD = 'Password123!';

describe('Sales finalization and dashboard workflow (e2e)', () => {
  let app: INestApplication<App>;
  let db: Kysely<DB>;
  let authCookies: string[];
  let buyerLeadId: string;
  let linkedVehicleId: string;
  let unlinkedVehicleId: string;
  let sellerLeadId: string;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();

    db = moduleFixture.get<Kysely<DB>>(DATABASE);
  });

  beforeEach(async () => {
    await db.deleteFrom('sales.commissions').execute();
    await db.deleteFrom('sales.sales').execute();
    await db.deleteFrom('crm.follow_ups').execute();
    await db.deleteFrom('crm.lead_vehicle_links').execute();
    await db.deleteFrom('inventory.vehicle_photos').execute();
    await db.deleteFrom('inventory.vehicles').execute();
    await db.deleteFrom('crm.buyer_leads').execute();
    await db.deleteFrom('crm.seller_leads').execute();
    await db.deleteFrom('auth.sessions').execute();
    await db.deleteFrom('auth.users').where('email', '=', ADMIN_EMAIL).execute();

    const user = await db
      .insertInto('auth.users')
      .values({
        email: ADMIN_EMAIL,
        password_hash: await hashPassword(PASSWORD),
        full_name: 'Sales Admin',
        role: 'admin',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    userId = user.id;

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: ADMIN_EMAIL,
        password: PASSWORD,
      })
      .expect(201);

    authCookies = [
      extractCookie(loginResponse.headers['set-cookie'], 'etc_access_token'),
      extractCookie(loginResponse.headers['set-cookie'], 'etc_refresh_token'),
    ];

    const sellerLead = await db
      .insertInto('crm.seller_leads')
      .values({
        seller_name: 'Seller Dashboard',
        contact_number: '09170000010',
        vehicle_brand: 'Toyota',
        vehicle_model: 'Fortuner',
        assignee_user_id: userId,
        status: 'New Inquiry',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    sellerLeadId = sellerLead.id;

    const buyerLead = await db
      .insertInto('crm.buyer_leads')
      .values({
        buyer_name: 'Buyer Dashboard',
        contact_number: '09170000011',
        email: 'buyer.dashboard@example.com',
        status: 'Reserved',
        assignee_user_id: userId,
        latest_activity_at: new Date(),
        closing_note: 'Ready to buy once unit is confirmed',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    buyerLeadId = buyerLead.id;

    const [availableVehicle, reservedVehicle, incomingVehicle] = await db
      .insertInto('inventory.vehicles')
      .values([
        {
          stock_number: 'SALE-1001',
          brand: 'Toyota',
          model: 'Fortuner',
          year: 2023,
          purchase_price: '1100000.00',
          target_selling_price: '1300000.00',
          minimum_acceptable_price: '1250000.00',
          status: 'Available',
        },
        {
          stock_number: 'SALE-1002',
          brand: 'Honda',
          model: 'City',
          year: 2022,
          purchase_price: '550000.00',
          target_selling_price: '650000.00',
          minimum_acceptable_price: '620000.00',
          status: 'Reserved',
        },
        {
          stock_number: 'SALE-1003',
          brand: 'Mitsubishi',
          model: 'Xpander',
          year: 2021,
          purchase_price: '700000.00',
          status: 'Incoming',
        },
      ])
      .returning(['id', 'stock_number'])
      .execute();

    linkedVehicleId = availableVehicle.id;
    unlinkedVehicleId = incomingVehicle.id;

    await db
      .insertInto('inventory.vehicle_photos')
      .values([
        {
          vehicle_id: availableVehicle.id,
          file_url: 'https://example.com/available-vehicle.jpg',
          sort_order: 0,
        },
        {
          vehicle_id: reservedVehicle.id,
          file_url: 'https://example.com/reserved-vehicle.jpg',
          sort_order: 0,
        },
      ])
      .execute();

    await db
      .insertInto('crm.lead_vehicle_links')
      .values({
        buyer_lead_id: buyerLeadId,
        vehicle_id: linkedVehicleId,
      })
      .execute();

    await db
      .insertInto('crm.follow_ups')
      .values([
        {
          lead_type: 'buyer',
          buyer_lead_id: buyerLeadId,
          seller_lead_id: null,
          assignee_user_id: userId,
          due_at: new Date(Date.now() - 86_400_000),
          status: 'Due',
          note: 'Overdue buyer follow-up',
        },
        {
          lead_type: 'seller',
          seller_lead_id: sellerLeadId,
          buyer_lead_id: null,
          assignee_user_id: userId,
          due_at: new Date(),
          status: 'Due',
          note: 'Due today seller follow-up',
        },
      ])
      .execute();
  });

  afterAll(async () => {
    if (!db) {
      return;
    }

    await db.deleteFrom('sales.commissions').execute();
    await db.deleteFrom('sales.sales').execute();
    await db.deleteFrom('crm.follow_ups').execute();
    await db.deleteFrom('crm.lead_vehicle_links').execute();
    await db.deleteFrom('inventory.vehicle_photos').execute();
    await db.deleteFrom('inventory.vehicles').execute();
    await db.deleteFrom('crm.buyer_leads').execute();
    await db.deleteFrom('crm.seller_leads').execute();
    await db.deleteFrom('auth.sessions').execute();
    await db.deleteFrom('auth.users').where('email', '=', ADMIN_EMAIL).execute();
    await app.close();
  });

  it('rejects anonymous access to sales and dashboard routes', async () => {
    await request(app.getHttpServer()).get('/sales').expect(401);
    await request(app.getHttpServer()).get('/dashboard').expect(401);
  });

  it('creates a valid sale, finalizes commission, and updates related records', async () => {
    const response = await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: linkedVehicleId,
        buyerLeadId,
        saleDate: new Date().toISOString(),
        finalSaleAmount: '1280000.00',
        agentName: 'Agent Cruz',
      })
      .expect(201);

    expect(response.body).toEqual({
      sale: expect.objectContaining({
        id: expect.any(String),
        vehicleId: linkedVehicleId,
        buyerLeadId,
        agentName: 'Agent Cruz',
        finalSaleAmount: '1280000.00',
        grossProfitAmount: '180000.00',
        commissionLocked: true,
      }),
      commission: expect.objectContaining({
        saleId: expect.any(String),
        agentName: 'Agent Cruz',
        finalAmount: expect.any(String),
      }),
      vehicle: expect.objectContaining({
        id: linkedVehicleId,
        status: 'Sold',
      }),
    });

    const vehicle = await db
      .selectFrom('inventory.vehicles')
      .select(['status'])
      .where('id', '=', linkedVehicleId)
      .executeTakeFirstOrThrow();
    expect(vehicle.status).toBe('Sold');

    const buyerLead = await db
      .selectFrom('crm.buyer_leads')
      .select(['status'])
      .where('id', '=', buyerLeadId)
      .executeTakeFirstOrThrow();
    expect(buyerLead.status).toBe('Won');
  });

  it('rejects a second sale for the same vehicle', async () => {
    await createSale(app, authCookies, linkedVehicleId, buyerLeadId);

    await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: linkedVehicleId,
        buyerLeadId,
        saleDate: new Date().toISOString(),
        finalSaleAmount: '1275000.00',
      })
      .expect(400);
  });

  it('rejects creating a sale for an unlinked buyer lead and vehicle pair', async () => {
    await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: unlinkedVehicleId,
        buyerLeadId,
        saleDate: new Date().toISOString(),
        finalSaleAmount: '900000.00',
      })
      .expect(400);
  });

  it('rejects commission override without a reason', async () => {
    await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: linkedVehicleId,
        buyerLeadId,
        saleDate: new Date().toISOString(),
        finalSaleAmount: '1280000.00',
        agentName: 'Agent Cruz',
        commissionOverrideAmount: '8000.00',
      })
      .expect(400);
  });

  it('returns dashboard metrics and operational queues', async () => {
    await createSale(app, authCookies, linkedVehicleId, buyerLeadId);

    const response = await request(app.getHttpServer())
      .get('/dashboard')
      .set('Cookie', authCookies)
      .expect(200);

    expect(response.body).toEqual({
      metrics: expect.objectContaining({
        availableVehicles: 0,
        reservedVehicles: 1,
        soldVehicles: 1,
        monthlySales: 1,
        monthlyRevenue: '1280000.00',
        monthlyProfit: '180000.00',
      }),
      queues: expect.objectContaining({
        overdueFollowUps: expect.arrayContaining([
          expect.objectContaining({
            leadType: 'buyer',
            status: 'Overdue',
          }),
        ]),
        dueTodayFollowUps: expect.arrayContaining([
          expect.objectContaining({
            leadType: 'seller',
            status: 'Due',
          }),
        ]),
        newSellerLeads: expect.arrayContaining([
          expect.objectContaining({
            id: sellerLeadId,
            status: 'New Inquiry',
          }),
        ]),
        newBuyerLeads: expect.arrayContaining([]),
      }),
    });
  });
});

async function createSale(
  app: INestApplication<App>,
  authCookies: string[],
  vehicleId: string,
  buyerLeadId: string,
) {
  return request(app.getHttpServer())
    .post('/sales')
    .set('Cookie', authCookies)
    .send({
      vehicleId,
      buyerLeadId,
      saleDate: new Date().toISOString(),
      finalSaleAmount: '1280000.00',
      agentName: 'Agent Cruz',
    })
    .expect(201);
}

function extractCookie(rawCookies: string[] | undefined, cookieName: string): string {
  const cookie = rawCookies?.find((value) => value.startsWith(`${cookieName}=`));

  if (!cookie) {
    throw new Error(`Missing cookie ${cookieName}`);
  }

  return cookie.split(';')[0];
}
