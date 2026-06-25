import 'dotenv/config';

import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Kysely } from 'kysely';

import { AppModule } from '../src/app.module';
import { DATABASE } from '../src/database/database.constants';
import type { DB } from '../src/database/db';
import { hashPassword } from '../src/common/utils/auth.utils';

const ADMIN_EMAIL = 'buyerlead.admin@example.com';
const PASSWORD = 'Password123!';

describe('Buyer leads and follow-ups workflow (e2e)', () => {
  let app: INestApplication<App>;
  let db: Kysely<DB>;
  let authCookies: string[];
  let sellerLeadId: string;
  let vehicleId: string;

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
    await db.deleteFrom('ops.activity_history').execute();
    await db.deleteFrom('sales.commissions').execute();
    await db.deleteFrom('sales.sales').execute();
    await db.deleteFrom('crm.follow_ups').execute();
    await db.deleteFrom('crm.lead_vehicle_links').execute();
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
        full_name: 'Buyer Lead Admin',
        role: 'admin',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

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
        seller_name: 'Seller One',
        contact_number: '09170000001',
        vehicle_brand: 'Toyota',
        vehicle_model: 'Rush',
        assignee_user_id: user.id,
        status: 'Contacted',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    sellerLeadId = sellerLead.id;

    const vehicle = await db
      .insertInto('inventory.vehicles')
      .values({
        stock_number: 'BL-1001',
        brand: 'Toyota',
        model: 'Rush',
        year: 2022,
        target_selling_price: '1050000.00',
        minimum_acceptable_price: '990000.00',
        status: 'Available',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    await db.deleteFrom('ops.activity_history').execute();
    await db.deleteFrom('sales.commissions').execute();
    await db.deleteFrom('sales.sales').execute();
    await db.deleteFrom('crm.follow_ups').execute();
    await db.deleteFrom('crm.lead_vehicle_links').execute();
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

  it('rejects anonymous access to buyer lead and follow-up routes', async () => {
    await request(app.getHttpServer()).get('/buyer-leads').expect(401);
    await request(app.getHttpServer()).get('/follow-ups').expect(401);
  });

  it('creates, lists, gets, and updates buyer leads', async () => {
    const createResponse = await createBuyerLead(app, authCookies);

    await request(app.getHttpServer())
      .get('/buyer-leads')
      .set('Cookie', authCookies)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/buyer-leads/${createResponse.body.buyerLead.id}`)
      .set('Cookie', authCookies)
      .expect(200);

    const updateResponse = await request(app.getHttpServer())
      .patch(`/buyer-leads/${createResponse.body.buyerLead.id}`)
      .set('Cookie', authCookies)
      .send({
        status: 'Contacted',
        notes: 'Reached by phone',
        assigneeUserId: createResponse.body.buyerLead.assigneeUserId,
      })
      .expect(200);

    expect(updateResponse.body.buyerLead.status).toBe('Contacted');
    expect(updateResponse.body.buyerLead.notes).toBe('Reached by phone');
  });

  it('requires required fields and assignee before leaving New Inquiry', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/buyer-leads')
      .set('Cookie', authCookies)
      .send({
        buyerName: 'Minimal Buyer',
        contactNumber: '09170000002',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/buyer-leads/${createResponse.body.buyerLead.id}`)
      .set('Cookie', authCookies)
      .send({
        status: 'Interested',
      })
      .expect(400);
  });

  it('requires closing note for Won and Lost statuses', async () => {
    const createResponse = await createBuyerLead(app, authCookies);

    await request(app.getHttpServer())
      .patch(`/buyer-leads/${createResponse.body.buyerLead.id}`)
      .set('Cookie', authCookies)
      .send({
        status: 'Lost',
        assigneeUserId: createResponse.body.buyerLead.assigneeUserId,
      })
      .expect(400);
  });

  it('links and unlinks vehicles, rejects duplicates, and requires vehicle links for Reserved status', async () => {
    const createResponse = await createBuyerLead(app, authCookies);
    const buyerLeadId = createResponse.body.buyerLead.id;

    await request(app.getHttpServer())
      .patch(`/buyer-leads/${buyerLeadId}`)
      .set('Cookie', authCookies)
      .send({
        status: 'Reserved',
        assigneeUserId: createResponse.body.buyerLead.assigneeUserId,
      })
      .expect(400);

    const linkResponse = await request(app.getHttpServer())
      .post(`/buyer-leads/${buyerLeadId}/vehicle-links`)
      .set('Cookie', authCookies)
      .send({
        vehicleId,
      })
      .expect(201);

    expect(linkResponse.body.buyerLead.vehicles).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: vehicleId })]),
    );

    await request(app.getHttpServer())
      .post(`/buyer-leads/${buyerLeadId}/vehicle-links`)
      .set('Cookie', authCookies)
      .send({
        vehicleId,
      })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/buyer-leads/${buyerLeadId}`)
      .set('Cookie', authCookies)
      .send({
        status: 'Reserved',
        assigneeUserId: createResponse.body.buyerLead.assigneeUserId,
      })
      .expect(200);

    const unlinkResponse = await request(app.getHttpServer())
      .delete(`/buyer-leads/${buyerLeadId}/vehicle-links/${vehicleId}`)
      .set('Cookie', authCookies)
      .expect(200);

    expect(unlinkResponse.body.buyerLead.vehicles).toEqual([]);
  });

  it('creates follow-ups for buyer and seller leads and lists due and overdue work', async () => {
    const createResponse = await createBuyerLead(app, authCookies);
    const buyerLeadId = createResponse.body.buyerLead.id;

    await request(app.getHttpServer())
      .post('/follow-ups')
      .set('Cookie', authCookies)
      .send({
        leadType: 'buyer',
        buyerLeadId,
        assigneeUserId: createResponse.body.buyerLead.assigneeUserId,
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        note: 'Call again tomorrow',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/follow-ups')
      .set('Cookie', authCookies)
      .send({
        leadType: 'seller',
        sellerLeadId,
        assigneeUserId: createResponse.body.buyerLead.assigneeUserId,
        dueAt: new Date(Date.now() - 86_400_000).toISOString(),
        note: 'Overdue seller callback',
      })
      .expect(201);

    const overdueResponse = await request(app.getHttpServer())
      .get('/follow-ups?status=Overdue')
      .set('Cookie', authCookies)
      .expect(200);

    expect(overdueResponse.body.followUps).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'Overdue' })]),
    );

    const dueResponse = await request(app.getHttpServer())
      .get('/follow-ups?status=Due')
      .set('Cookie', authCookies)
      .expect(200);

    expect(dueResponse.body.followUps).toEqual(
      expect.arrayContaining([expect.objectContaining({ leadType: 'buyer' })]),
    );
  });

  it('filters and paginates buyer leads, seller leads, and follow-ups from query params', async () => {
    const assigneeUserId = await currentUserId(app);

    await request(app.getHttpServer())
      .post('/buyer-leads')
      .set('Cookie', authCookies)
      .send({
        buyerName: 'Alpha Buyer',
        contactNumber: '09170010001',
        email: 'alpha@example.com',
        desiredBudget: '900000.00',
        status: 'Contacted',
        assigneeUserId,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/buyer-leads')
      .set('Cookie', authCookies)
      .send({
        buyerName: 'Bravo Buyer',
        contactNumber: '09170010002',
        email: 'bravo@example.com',
        desiredBudget: '1200000.00',
        status: 'Interested',
        assigneeUserId,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/buyer-leads')
      .set('Cookie', authCookies)
      .send({
        buyerName: 'Charlie Buyer',
        contactNumber: '09170010003',
        email: 'charlie@example.com',
        desiredBudget: '1500000.00',
        status: 'Interested',
        assigneeUserId,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/seller-leads')
      .set('Cookie', authCookies)
      .send({
        sellerName: 'Searchable Seller',
        contactNumber: '09175550001',
        vehicleBrand: 'Ford',
        vehicleModel: 'Ranger',
        vehicleVariant: 'Wildtrak',
        status: 'Negotiating',
        assigneeUserId,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/seller-leads')
      .set('Cookie', authCookies)
      .send({
        sellerName: 'Plain Seller',
        contactNumber: '09175550002',
        vehicleBrand: 'Toyota',
        vehicleModel: 'Vios',
        status: 'Contacted',
        assigneeUserId,
      })
      .expect(201);

    const paginatedBuyerLeads = await request(app.getHttpServer())
      .get('/buyer-leads?status=Interested&search=buyer&page=2&pageSize=1')
      .set('Cookie', authCookies)
      .expect(200);

    expect(paginatedBuyerLeads.body).toEqual(
      expect.objectContaining({
        page: 2,
        pageSize: 1,
        total: 2,
        totalPages: 2,
      }),
    );
    expect(paginatedBuyerLeads.body.buyerLeads).toHaveLength(1);
    expect(paginatedBuyerLeads.body.buyerLeads[0]).toEqual(
      expect.objectContaining({
        status: 'Interested',
      }),
    );

    const filteredSellerLeads = await request(app.getHttpServer())
      .get('/seller-leads?status=Negotiating&search=wildtrak&page=1&pageSize=5')
      .set('Cookie', authCookies)
      .expect(200);

    expect(filteredSellerLeads.body).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 5,
        total: 1,
        totalPages: 1,
      }),
    );
    expect(filteredSellerLeads.body.sellerLeads).toEqual([
      expect.objectContaining({
        sellerName: 'Searchable Seller',
        vehicleVariant: 'Wildtrak',
        status: 'Negotiating',
      }),
    ]);

    const buyerLeadResponse = await createBuyerLead(app, authCookies);
    const buyerLeadId = buyerLeadResponse.body.buyerLead.id;

    await request(app.getHttpServer())
      .post('/follow-ups')
      .set('Cookie', authCookies)
      .send({
        leadType: 'buyer',
        buyerLeadId,
        assigneeUserId,
        dueAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
        note: 'Alpha callback about financing',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/follow-ups')
      .set('Cookie', authCookies)
      .send({
        leadType: 'buyer',
        buyerLeadId,
        assigneeUserId,
        dueAt: new Date(Date.now() + 8 * 3_600_000).toISOString(),
        note: 'Bravo showroom visit',
      })
      .expect(201);

    const filteredFollowUps = await request(app.getHttpServer())
      .get(`/follow-ups?status=Due&leadType=buyer&assigneeUserId=${assigneeUserId}&search=financing&page=1&pageSize=1`)
      .set('Cookie', authCookies)
      .expect(200);

    expect(filteredFollowUps.body).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      }),
    );
    expect(filteredFollowUps.body.followUps).toEqual([
      expect.objectContaining({
        leadType: 'buyer',
        note: 'Alpha callback about financing',
        status: 'Due',
      }),
    ]);
  });

  it('excludes won buyer leads when eligibleForSale is requested', async () => {
    const assigneeUserId = await currentUserId(app);

    await request(app.getHttpServer())
      .post('/buyer-leads')
      .set('Cookie', authCookies)
      .send({
        buyerName: 'Eligible Buyer',
        contactNumber: '09170010101',
        status: 'Interested',
        assigneeUserId,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/buyer-leads')
      .set('Cookie', authCookies)
      .send({
        buyerName: 'Won Buyer',
        contactNumber: '09170010102',
        status: 'Won',
        assigneeUserId,
        closingNote: 'Sale already completed.',
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get('/buyer-leads?eligibleForSale=true&search=buyer')
      .set('Cookie', authCookies)
      .expect(200);

    expect(response.body.buyerLeads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          buyerName: 'Eligible Buyer',
          status: 'Interested',
        }),
      ]),
    );
    expect(response.body.buyerLeads).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          buyerName: 'Won Buyer',
          status: 'Won',
        }),
      ]),
    );
  });

  it('completes a follow-up and prevents duplicate completion', async () => {
    const createResponse = await createBuyerLead(app, authCookies);
    const buyerLeadId = createResponse.body.buyerLead.id;

    const followUpResponse = await request(app.getHttpServer())
      .post('/follow-ups')
      .set('Cookie', authCookies)
      .send({
        leadType: 'buyer',
        buyerLeadId,
        assigneeUserId: createResponse.body.buyerLead.assigneeUserId,
        dueAt: new Date(Date.now() + 3600_000).toISOString(),
        note: 'Check reservation interest',
      })
      .expect(201);

    const completeResponse = await request(app.getHttpServer())
      .post(`/follow-ups/${followUpResponse.body.followUp.id}/complete`)
      .set('Cookie', authCookies)
      .send({
        outcomeNote: 'Buyer confirmed they will visit tomorrow',
      })
      .expect(200);

    expect(completeResponse.body.followUp.status).toBe('Completed');
    expect(completeResponse.body.followUp.completedAt).toBeTruthy();

    await request(app.getHttpServer())
      .post(`/follow-ups/${followUpResponse.body.followUp.id}/complete`)
      .set('Cookie', authCookies)
      .send({
        outcomeNote: 'Second completion should fail',
      })
      .expect(400);
  });

  it('paginates entity and global activity history responses while keeping events in the payload', async () => {
    const firstLeadResponse = await request(app.getHttpServer())
      .post('/buyer-leads')
      .set('Cookie', authCookies)
      .send({
        buyerName: 'Activity Buyer One',
        contactNumber: '09170020001',
        assigneeUserId: await currentUserId(app),
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/buyer-leads/${firstLeadResponse.body.buyerLead.id}`)
      .set('Cookie', authCookies)
      .send({
        status: 'Contacted',
        assigneeUserId: firstLeadResponse.body.buyerLead.assigneeUserId,
        notes: 'Reached out for activity timeline test',
      })
      .expect(200);

    await request(app.getHttpServer())
      .post('/buyer-leads')
      .set('Cookie', authCookies)
      .send({
        buyerName: 'Activity Buyer Two',
        contactNumber: '09170020002',
        assigneeUserId: await currentUserId(app),
      })
      .expect(201);

    const entityHistoryResponse = await request(app.getHttpServer())
      .get(`/activity-history/buyer_lead/${firstLeadResponse.body.buyerLead.id}?page=1&pageSize=2`)
      .set('Cookie', authCookies)
      .expect(200);

    expect(entityHistoryResponse.body).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 2,
        total: 3,
        totalPages: 2,
        events: expect.any(Array),
      }),
    );
    expect(entityHistoryResponse.body.events).toHaveLength(2);
    expect(entityHistoryResponse.body.events[0]).toEqual(
      expect.objectContaining({
        entityType: 'buyer_lead',
        entityId: firstLeadResponse.body.buyerLead.id,
      }),
    );

    const globalHistoryResponse = await request(app.getHttpServer())
      .get('/activity-history?page=2&pageSize=2')
      .set('Cookie', authCookies)
      .expect(200);

    expect(globalHistoryResponse.body).toEqual(
      expect.objectContaining({
        page: 2,
        pageSize: 2,
        total: 4,
        totalPages: 2,
        events: expect.any(Array),
      }),
    );
    expect(globalHistoryResponse.body.events).toHaveLength(2);
    expect(globalHistoryResponse.body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: firstLeadResponse.body.buyerLead.id,
          entityType: 'buyer_lead',
        }),
      ]),
    );

    const legacyLimitResponse = await request(app.getHttpServer())
      .get(`/activity-history/buyer_lead/${firstLeadResponse.body.buyerLead.id}?limit=1`)
      .set('Cookie', authCookies)
      .expect(200);

    expect(legacyLimitResponse.body).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 1,
        total: 3,
        totalPages: 3,
      }),
    );
    expect(legacyLimitResponse.body.events).toHaveLength(1);
  });
});

async function createBuyerLead(
  app: INestApplication<App>,
  authCookies: string[],
) {
  return request(app.getHttpServer())
    .post('/buyer-leads')
    .set('Cookie', authCookies)
    .send({
      buyerName: 'Buyer One',
      contactNumber: '09170000003',
      email: 'buyer.one@example.com',
      inquirySource: 'Facebook',
      desiredBudget: '1000000.00',
      notes: 'Interested in SUVs',
      assigneeUserId: await currentUserId(app),
    })
    .expect(201);
}

async function currentUserId(app: INestApplication<App>) {
  const db = app.get<Kysely<DB>>(DATABASE);
  const user = await db
    .selectFrom('authentication.users')
    .select(['id'])
    .where('email', '=', ADMIN_EMAIL)
    .executeTakeFirstOrThrow();

  return user.id;
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
