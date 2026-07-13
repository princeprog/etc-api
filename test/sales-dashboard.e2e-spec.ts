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
    await db.deleteFrom('inventory.vehicle_tracked_costs').execute();
    await db.deleteFrom('inventory.vehicle_photos').execute();
    await db.deleteFrom('inventory.vehicles').execute();
    await db.deleteFrom('crm.buyer_leads').execute();
    await db.deleteFrom('crm.seller_leads').execute();
    await db.deleteFrom('authentication.sessions').execute();
    await db
      .deleteFrom('authentication.users')
      .where('email', '=', ADMIN_EMAIL)
      .execute();

    const user = await db
      .insertInto('authentication.users')
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
    await db.deleteFrom('inventory.vehicle_tracked_costs').execute();
    await db.deleteFrom('inventory.vehicle_photos').execute();
    await db.deleteFrom('inventory.vehicles').execute();
    await db.deleteFrom('crm.buyer_leads').execute();
    await db.deleteFrom('crm.seller_leads').execute();
    await db.deleteFrom('authentication.sessions').execute();
    await db
      .deleteFrom('authentication.users')
      .where('email', '=', ADMIN_EMAIL)
      .execute();
    await app.close();
  });

  it('rejects anonymous access to sales and dashboard routes', async () => {
    await request(app.getHttpServer()).get('/sales').expect(401);
    await request(app.getHttpServer()).get('/dashboard').expect(401);
  });

  it('creates a valid sale, finalizes commission, and updates related records', async () => {
    await db
      .insertInto('inventory.vehicle_tracked_costs')
      .values({
        vehicle_id: linkedVehicleId,
        category: 'reconditioning',
        amount: '30000.00',
        note: 'Pre-sale reconditioning',
      })
      .execute();

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
        saleNumber: expect.any(String),
        vehicleId: linkedVehicleId,
        buyerLeadId,
        agentName: 'Agent Cruz',
        finalSaleAmount: '1280000.00',
        grossProfitAmount: '180000.00',
        trackedCostsTotal: '30000.00',
        profitAfterTrackedCosts: '150000.00',
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
        trackedCostsTotal: '30000.00',
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

    expect(response.body.sale.saleNumber).toBe('S-2026-001');
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

  it('rejects creating a sale for a buyer lead that is already won', async () => {
    await db
      .updateTable('crm.buyer_leads')
      .set({
        status: 'Won',
        closing_note: 'Already closed.',
        updated_at: new Date(),
      })
      .where('id', '=', buyerLeadId)
      .execute();

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
        activeInventory: 2,
        activeSellerLeads: 1,
        sellerLeadsRequiringAction: 1,
        inspectionsPending: 0,
        approvedLeadsAwaitingConversion: 0,
        availableVehicles: 0,
        reservedVehicles: 1,
        soldVehicles: 1,
        monthlySales: 1,
        monthlyRevenue: '1280000.00',
        monthlyProfit: '180000.00',
      }),
      analytics: {
        acquisitionSalesTrend: {
          twelveWeeks: expect.arrayContaining([
            expect.objectContaining({
              label: expect.any(String),
              periodStart: expect.any(String),
              vehiclesAcquired: expect.any(Number),
              vehiclesSold: expect.any(Number),
            }),
          ]),
          sixMonths: expect.any(Array),
          oneYear: expect.any(Array),
        },
        sellerLeadPipeline: expect.arrayContaining([
          {
            status: 'New Inquiry',
            count: 1,
          },
        ]),
      },
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

  it('assigns yearly sale numbers and returns them from list/detail endpoints', async () => {
    const firstSaleResponse = await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: linkedVehicleId,
        buyerLeadId,
        saleDate: '2026-05-30T15:15:00.000Z',
        finalSaleAmount: '1280000.00',
        agentName: 'Agent Cruz',
      })
      .expect(201);

    const secondPair = await seedLinkedSalePair(db, userId, {
      stockNumber: 'SALE-2001',
      brand: 'Ford',
      model: 'Everest',
      year: 2025,
      purchasePrice: '1500000.00',
      targetSellingPrice: '1750000.00',
      minimumAcceptablePrice: '1680000.00',
      buyerName: 'Buyer Second',
      buyerContactNumber: '09170000021',
      buyerEmail: 'buyer.second@example.com',
    });

    const secondSaleResponse = await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: secondPair.vehicleId,
        buyerLeadId: secondPair.buyerLeadId,
        saleDate: '2026-06-01T09:30:00.000Z',
        finalSaleAmount: '1700000.00',
        agentName: 'Agent Cruz',
      })
      .expect(201);

    const thirdPair = await seedLinkedSalePair(db, userId, {
      stockNumber: 'SALE-3001',
      brand: 'Isuzu',
      model: 'MUX',
      year: 2024,
      purchasePrice: '1300000.00',
      targetSellingPrice: '1500000.00',
      minimumAcceptablePrice: '1450000.00',
      buyerName: 'Buyer Third',
      buyerContactNumber: '09170000031',
      buyerEmail: 'buyer.third@example.com',
    });

    const thirdSaleResponse = await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: thirdPair.vehicleId,
        buyerLeadId: thirdPair.buyerLeadId,
        saleDate: '2027-01-15T11:45:00.000Z',
        finalSaleAmount: '1490000.00',
        agentName: 'Agent Cruz',
      })
      .expect(201);

    expect(firstSaleResponse.body.sale.saleNumber).toBe('S-2026-001');
    expect(secondSaleResponse.body.sale.saleNumber).toBe('S-2026-002');
    expect(thirdSaleResponse.body.sale.saleNumber).toBe('S-2027-001');

    const listResponse = await request(app.getHttpServer())
      .get('/sales')
      .set('Cookie', authCookies)
      .expect(200);

    expect(listResponse.body.sales).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstSaleResponse.body.sale.id,
          saleNumber: 'S-2026-001',
        }),
        expect.objectContaining({
          id: secondSaleResponse.body.sale.id,
          saleNumber: 'S-2026-002',
        }),
        expect.objectContaining({
          id: thirdSaleResponse.body.sale.id,
          saleNumber: 'S-2027-001',
        }),
      ]),
    );

    const detailResponse = await request(app.getHttpServer())
      .get(`/sales/${secondSaleResponse.body.sale.id}`)
      .set('Cookie', authCookies)
      .expect(200);

    expect(detailResponse.body.sale).toEqual(
      expect.objectContaining({
        id: secondSaleResponse.body.sale.id,
        saleNumber: 'S-2026-002',
        buyerLead: expect.objectContaining({
          id: secondPair.buyerLeadId,
          buyerName: 'Buyer Second',
          contactNumber: '09170000021',
          email: 'buyer.second@example.com',
          status: 'Won',
          closingNote: 'Ready to buy once unit is confirmed',
        }),
      }),
    );
  });

  it('filters and paginates sales lists from backend query params', async () => {
    const firstSale = await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: linkedVehicleId,
        buyerLeadId,
        saleDate: '2026-06-01T09:30:00.000Z',
        finalSaleAmount: '1280000.00',
        agentName: 'Agent Cruz',
      })
      .expect(201);

    const secondPair = await seedLinkedSalePair(db, userId, {
      stockNumber: 'SALE-4001',
      brand: 'Ford',
      model: 'Everest',
      year: 2024,
      purchasePrice: '1500000.00',
      targetSellingPrice: '1700000.00',
      minimumAcceptablePrice: '1650000.00',
      buyerName: 'Filter Buyer One',
      buyerContactNumber: '09170000041',
      buyerEmail: 'filter-buyer-one@example.com',
    });

    const secondSale = await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: secondPair.vehicleId,
        buyerLeadId: secondPair.buyerLeadId,
        saleDate: '2026-06-15T10:00:00.000Z',
        finalSaleAmount: '1690000.00',
        agentName: 'Agent Mira',
        commissionOverrideAmount: '8000.00',
        commissionOverrideReason: 'Top closer bonus',
      })
      .expect(201);

    const thirdPair = await seedLinkedSalePair(db, userId, {
      stockNumber: 'SALE-4002',
      brand: 'Nissan',
      model: 'Terra',
      year: 2023,
      purchasePrice: '1400000.00',
      targetSellingPrice: '1550000.00',
      minimumAcceptablePrice: '1500000.00',
      buyerName: 'Filter Buyer Two',
      buyerContactNumber: '09170000042',
      buyerEmail: 'filter-buyer-two@example.com',
    });

    const thirdSale = await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: thirdPair.vehicleId,
        buyerLeadId: thirdPair.buyerLeadId,
        saleDate: '2026-05-01T12:00:00.000Z',
        finalSaleAmount: '1540000.00',
      })
      .expect(201);

    await db
      .updateTable('sales.sales')
      .set({
        commission_locked: false,
        updated_at: new Date(),
      })
      .where('id', '=', thirdSale.body.sale.id)
      .execute();

    const filteredSales = await request(app.getHttpServer())
      .get(
        '/sales?search=agent&status=commission_locked&agentName=Agent Mira&dateRange=this_month&page=1&pageSize=1',
      )
      .set('Cookie', authCookies)
      .expect(200);

    expect(filteredSales.body).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      }),
    );
    expect(filteredSales.body.sales).toEqual([
      expect.objectContaining({
        id: secondSale.body.sale.id,
        saleNumber: secondSale.body.sale.saleNumber,
        agentName: 'Agent Mira',
        commissionLocked: true,
      }),
    ]);

    const needsReviewSales = await request(app.getHttpServer())
      .get('/sales?status=needs_review&page=1&pageSize=5')
      .set('Cookie', authCookies)
      .expect(200);

    expect(needsReviewSales.body).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 5,
        total: 1,
        totalPages: 1,
      }),
    );
    expect(needsReviewSales.body.sales).toEqual([
      expect.objectContaining({
        id: thirdSale.body.sale.id,
        commissionLocked: false,
      }),
    ]);

    const paginatedAllSales = await request(app.getHttpServer())
      .get('/sales?page=2&pageSize=1')
      .set('Cookie', authCookies)
      .expect(200);

    expect(paginatedAllSales.body.page).toBe(2);
    expect(paginatedAllSales.body.pageSize).toBe(1);
    expect(paginatedAllSales.body.total).toBe(3);
    expect(paginatedAllSales.body.totalPages).toBe(3);
    expect(paginatedAllSales.body.sales).toHaveLength(1);
    expect(
      [
        firstSale.body.sale.id,
        secondSale.body.sale.id,
        thirdSale.body.sale.id,
      ].includes(paginatedAllSales.body.sales[0].id),
    ).toBe(true);
  });

  it('returns filter-aware sales summary totals that ignore pagination', async () => {
    await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: linkedVehicleId,
        buyerLeadId,
        saleDate: '2026-06-01T09:30:00.000Z',
        finalSaleAmount: '1280000.00',
        agentName: 'Agent Cruz',
      })
      .expect(201);

    const secondPair = await seedLinkedSalePair(db, userId, {
      stockNumber: 'SALE-5001',
      brand: 'Ford',
      model: 'Everest',
      year: 2024,
      purchasePrice: '1500000.00',
      targetSellingPrice: '1700000.00',
      minimumAcceptablePrice: '1650000.00',
      buyerName: 'Summary Buyer One',
      buyerContactNumber: '09170000051',
      buyerEmail: 'summary-buyer-one@example.com',
    });

    await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: secondPair.vehicleId,
        buyerLeadId: secondPair.buyerLeadId,
        saleDate: '2026-06-15T10:00:00.000Z',
        finalSaleAmount: '1690000.00',
        agentName: 'Agent Mira',
        commissionOverrideAmount: '8000.00',
        commissionOverrideReason: 'Top closer bonus',
      })
      .expect(201);

    const thirdPair = await seedLinkedSalePair(db, userId, {
      stockNumber: 'SALE-5002',
      brand: 'Nissan',
      model: 'Terra',
      year: 2023,
      purchasePrice: '1400000.00',
      targetSellingPrice: '1550000.00',
      minimumAcceptablePrice: '1500000.00',
      buyerName: 'Summary Buyer Two',
      buyerContactNumber: '09170000052',
      buyerEmail: 'summary-buyer-two@example.com',
    });

    const thirdSale = await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: thirdPair.vehicleId,
        buyerLeadId: thirdPair.buyerLeadId,
        saleDate: '2026-05-01T12:00:00.000Z',
        finalSaleAmount: '1540000.00',
      })
      .expect(201);

    await db
      .updateTable('sales.sales')
      .set({
        commission_locked: false,
        updated_at: new Date(),
      })
      .where('id', '=', thirdSale.body.sale.id)
      .execute();

    const summaryResponse = await request(app.getHttpServer())
      .get(
        '/sales/summary?search=agent&status=commission_locked&agentName=Agent Mira&dateRange=this_month&page=99&pageSize=1',
      )
      .set('Cookie', authCookies)
      .expect(200);

    expect(summaryResponse.body).toEqual({
      totalSales: 1,
      totalRevenue: '1690000.00',
      totalGrossProfit: '190000.00',
      totalCommissionPayouts: '8000.00',
      totalProfitAfterTrackedCosts: '190000.00',
    });

    const allSummaryResponse = await request(app.getHttpServer())
      .get('/sales/summary')
      .set('Cookie', authCookies)
      .expect(200);

    expect(allSummaryResponse.body).toEqual({
      totalSales: 3,
      totalRevenue: '4510000.00',
      totalGrossProfit: '510000.00',
      totalCommissionPayouts: '13000.00',
      totalProfitAfterTrackedCosts: '510000.00',
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

function extractCookie(
  rawCookies: string[] | undefined,
  cookieName: string,
): string {
  const cookie = rawCookies?.find((value) =>
    value.startsWith(`${cookieName}=`),
  );

  if (!cookie) {
    throw new Error(`Missing cookie ${cookieName}`);
  }

  return cookie.split(';')[0];
}

async function seedLinkedSalePair(
  db: Kysely<DB>,
  userId: string,
  input: {
    stockNumber: string;
    brand: string;
    model: string;
    year: number;
    purchasePrice: string;
    targetSellingPrice: string;
    minimumAcceptablePrice: string;
    buyerName: string;
    buyerContactNumber: string;
    buyerEmail: string;
  },
) {
  const buyerLead = await db
    .insertInto('crm.buyer_leads')
    .values({
      buyer_name: input.buyerName,
      contact_number: input.buyerContactNumber,
      email: input.buyerEmail,
      status: 'Reserved',
      assignee_user_id: userId,
      latest_activity_at: new Date(),
      closing_note: 'Ready to buy once unit is confirmed',
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();

  const vehicle = await db
    .insertInto('inventory.vehicles')
    .values({
      stock_number: input.stockNumber,
      brand: input.brand,
      model: input.model,
      year: input.year,
      purchase_price: input.purchasePrice,
      target_selling_price: input.targetSellingPrice,
      minimum_acceptable_price: input.minimumAcceptablePrice,
      status: 'Available',
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();

  await db
    .insertInto('inventory.vehicle_photos')
    .values({
      vehicle_id: vehicle.id,
      file_url: `https://example.com/${input.stockNumber.toLowerCase()}.jpg`,
      sort_order: 0,
    })
    .execute();

  await db
    .insertInto('crm.lead_vehicle_links')
    .values({
      buyer_lead_id: buyerLead.id,
      vehicle_id: vehicle.id,
    })
    .execute();

  return {
    buyerLeadId: buyerLead.id,
    vehicleId: vehicle.id,
  };
}
