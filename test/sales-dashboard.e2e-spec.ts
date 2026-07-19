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
const STAFF_EMAIL = 'sales.staff@example.com';
const PASSWORD = 'Password123!';
const DASHBOARD_EXPENSE_TITLES = [
  'Dashboard current expense',
  'Dashboard older expense',
];

jest.setTimeout(15000);

describe('Sales finalization and dashboard workflow (e2e)', () => {
  let app: INestApplication<App>;
  let db: Kysely<DB>;
  let authCookies: string[];
  let staffAuthCookies: string[];
  let buyerLeadId: string;
  let linkedVehicleId: string;
  let unlinkedVehicleId: string;
  let sellerLeadId: string;
  let userId: string;
  let staffUserId: string;

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
    await db
      .deleteFrom('finance.expenses')
      .where('title', 'in', DASHBOARD_EXPENSE_TITLES)
      .execute();
    await db.deleteFrom('authentication.sessions').execute();
    await db
      .deleteFrom('authentication.users')
      .where('email', 'in', [ADMIN_EMAIL, STAFF_EMAIL])
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

    const staffUser = await db
      .insertInto('authentication.users')
      .values({
        email: STAFF_EMAIL,
        password_hash: await hashPassword(PASSWORD),
        full_name: 'Sales Staff',
        role: 'staff',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    staffUserId = staffUser.id;

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

    const staffLoginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: STAFF_EMAIL,
        password: PASSWORD,
      })
      .expect(201);

    staffAuthCookies = [
      extractCookie(
        staffLoginResponse.headers['set-cookie'],
        'etc_access_token',
      ),
      extractCookie(
        staffLoginResponse.headers['set-cookie'],
        'etc_refresh_token',
      ),
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
    await db
      .deleteFrom('finance.expenses')
      .where('title', 'in', DASHBOARD_EXPENSE_TITLES)
      .execute();
    await db.deleteFrom('authentication.sessions').execute();
    await db
      .deleteFrom('authentication.users')
      .where('email', 'in', [ADMIN_EMAIL, STAFF_EMAIL])
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
        defaultAmount: '10000.00',
        overrideAmount: null,
        finalAmount: '10000.00',
        overrideReason: null,
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

  it('auto-links an unlinked buyer lead and vehicle pair when finalizing a sale', async () => {
    const response = await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: unlinkedVehicleId,
        buyerLeadId,
        saleDate: new Date().toISOString(),
        finalSaleAmount: '900000.00',
      })
      .expect(201);

    expect(response.body.sale).toEqual(
      expect.objectContaining({
        vehicleId: unlinkedVehicleId,
        buyerLeadId,
      }),
    );
  });

  it('ignores commission override input and uses fixed commission', async () => {
    const response = await request(app.getHttpServer())
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
      .expect(201);

    expect(response.body.commission).toEqual(
      expect.objectContaining({
        defaultAmount: '10000.00',
        overrideAmount: null,
        finalAmount: '10000.00',
        overrideReason: null,
      }),
    );
  });

  it('returns a range-aware admin overview with coherent inventory totals', async () => {
    await createSale(app, authCookies, linkedVehicleId, buyerLeadId);

    const olderPair = await seedLinkedSalePair(db, userId, {
      stockNumber: 'SALE-DASH-OLD',
      brand: 'Nissan',
      model: 'Almera',
      year: 2022,
      purchasePrice: '500000.00',
      targetSellingPrice: '650000.00',
      minimumAcceptablePrice: '620000.00',
      buyerName: 'Dashboard Older Buyer',
      buyerContactNumber: '09170000061',
      buyerEmail: 'dashboard.older@example.com',
    });

    await request(app.getHttpServer())
      .post('/sales')
      .set('Cookie', authCookies)
      .send({
        vehicleId: olderPair.vehicleId,
        buyerLeadId: olderPair.buyerLeadId,
        saleDate: '2026-01-15T09:00:00.000Z',
        finalSaleAmount: '640000.00',
        agentName: 'Agent Cruz',
      })
      .expect(201);

    const category = await db
      .selectFrom('finance.expense_categories')
      .select('id')
      .where('is_active', '=', true)
      .executeTakeFirstOrThrow();

    await db
      .insertInto('finance.expenses')
      .values([
        {
          title: DASHBOARD_EXPENSE_TITLES[0],
          category_id: category.id,
          expected_amount: '1200.00',
          due_date: new Date('2026-07-19T00:00:00.000Z'),
          status: 'unpaid',
          created_by_user_id: userId,
        },
        {
          title: DASHBOARD_EXPENSE_TITLES[1],
          category_id: category.id,
          expected_amount: '9000.00',
          due_date: new Date('2026-01-15T00:00:00.000Z'),
          status: 'unpaid',
          created_by_user_id: userId,
        },
      ])
      .execute();

    const thisMonth = await request(app.getHttpServer())
      .get('/dashboard?range=this_month')
      .set('Cookie', authCookies)
      .expect(200);

    const yearToDate = await request(app.getHttpServer())
      .get('/dashboard?range=year_to_date')
      .set('Cookie', authCookies)
      .expect(200);

    expect(thisMonth.body).toEqual(
      expect.objectContaining({
        view: 'admin',
        period: expect.objectContaining({
          key: 'this_month',
          label: 'This month',
          groupBy: 'day',
        }),
        performance: expect.objectContaining({
          totalSales: 1,
          revenue: '1280000.00',
          grossProfit: '180000.00',
          expenses: expect.objectContaining({
            totalExpectedAmount: '1200.00',
          }),
        }),
        attention: expect.objectContaining({
          overdueFollowUps: expect.any(Number),
          dueTodayFollowUps: expect.any(Number),
          pendingInspections: 0,
        }),
      }),
    );

    expect(yearToDate.body.performance).toEqual(
      expect.objectContaining({
        totalSales: 2,
        revenue: '1920000.00',
        expenses: expect.objectContaining({
          totalExpectedAmount: '10200.00',
        }),
      }),
    );
    expect(yearToDate.body.inventory).toEqual(thisMonth.body.inventory);

    const statusTotal = Object.values(
      thisMonth.body.inventory.statuses as Record<string, number>,
    ).reduce((sum, count) => sum + count, 0);
    expect(statusTotal).toBe(thisMonth.body.inventory.active);
    expect(thisMonth.body.inventory.quality).toEqual(
      expect.objectContaining({
        totalActiveVehicles: thisMonth.body.inventory.active,
        gradeCounts: expect.any(Object),
      }),
    );
  });

  it('returns assigned work and personal sales for staff users only', async () => {
    const staffSeller = await db
      .insertInto('crm.seller_leads')
      .values({
        seller_name: 'Staff Seller',
        contact_number: '09170000071',
        vehicle_brand: 'Honda',
        vehicle_model: 'Civic',
        assignee_user_id: staffUserId,
        status: 'New Inquiry',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('crm.follow_ups')
      .values({
        lead_type: 'seller',
        seller_lead_id: staffSeller.id,
        buyer_lead_id: null,
        assignee_user_id: staffUserId,
        due_at: new Date(Date.now() - 60_000),
        status: 'Due',
        note: 'Staff-only follow-up',
      })
      .execute();

    const staffPair = await seedLinkedSalePair(db, staffUserId, {
      stockNumber: 'SALE-STAFF-1',
      brand: 'Mazda',
      model: 'CX-5',
      year: 2024,
      purchasePrice: '1000000.00',
      targetSellingPrice: '1200000.00',
      minimumAcceptablePrice: '1150000.00',
      buyerName: 'Staff Buyer',
      buyerContactNumber: '09170000072',
      buyerEmail: 'staff.buyer@example.com',
    });

    await createSale(
      app,
      staffAuthCookies,
      staffPair.vehicleId,
      staffPair.buyerLeadId,
    );

    const response = await request(app.getHttpServer())
      .get('/dashboard?range=this_month')
      .set('Cookie', staffAuthCookies)
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        view: 'staff',
        assignments: expect.objectContaining({
          openLeads: 1,
          activeSellerLeads: 1,
          activeBuyerLeads: 0,
          overdueFollowUps: 1,
        }),
        personalPerformance: expect.objectContaining({
          totalSales: 1,
          revenue: '1280000.00',
          trend: expect.any(Array),
        }),
        priorityQueue: [
          expect.objectContaining({
            leadId: staffSeller.id,
            leadName: 'Staff Seller',
            urgency: 'overdue',
          }),
        ],
      }),
    );
    expect(response.body.pipelines.seller).toEqual(
      expect.arrayContaining([{ status: 'New Inquiry', count: 1 }]),
    );

    const activities = await request(app.getHttpServer())
      .get(`/activity-history?actorUserId=${staffUserId}&page=1&pageSize=50`)
      .set('Cookie', staffAuthCookies)
      .expect(200);

    expect(activities.body.events.length).toBeGreaterThan(0);
    expect(
      activities.body.events.every(
        (event: { actorUserId: string | null }) =>
          event.actorUserId === staffUserId,
      ),
    ).toBe(true);
  });

  it('rejects unsupported dashboard ranges', async () => {
    await request(app.getHttpServer())
      .get('/dashboard?range=last_week')
      .set('Cookie', authCookies)
      .expect(400);
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
        saleDate: '2026-07-01T09:30:00.000Z',
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
        saleDate: '2026-07-01T09:30:00.000Z',
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
        saleDate: '2026-07-15T10:00:00.000Z',
        finalSaleAmount: '1690000.00',
        agentName: 'Agent Mira',
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
        '/sales?search=agent&status=finalized&agentName=Agent Mira&dateRange=this_month&page=1&pageSize=1',
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
        saleDate: '2026-07-01T09:30:00.000Z',
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
        saleDate: '2026-07-15T10:00:00.000Z',
        finalSaleAmount: '1690000.00',
        agentName: 'Agent Mira',
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
        '/sales/summary?search=agent&status=finalized&agentName=Agent Mira&dateRange=this_month&page=99&pageSize=1',
      )
      .set('Cookie', authCookies)
      .expect(200);

    expect(summaryResponse.body).toEqual({
      totalSales: 1,
      totalRevenue: '1690000.00',
      totalGrossProfit: '190000.00',
      totalCommissionPayouts: '10000.00',
      totalProfitAfterTrackedCosts: '190000.00',
      totalDrafts: 0,
    });

    const allSummaryResponse = await request(app.getHttpServer())
      .get('/sales/summary')
      .set('Cookie', authCookies)
      .expect(200);

    expect(allSummaryResponse.body).toEqual({
      totalSales: 3,
      totalRevenue: '4510000.00',
      totalGrossProfit: '510000.00',
      totalCommissionPayouts: '20000.00',
      totalProfitAfterTrackedCosts: '510000.00',
      totalDrafts: 0,
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
