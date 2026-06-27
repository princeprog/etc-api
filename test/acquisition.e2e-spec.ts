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

const ADMIN_EMAIL = 'acquisition.admin@example.com';
const PASSWORD = 'Password123!';

describe('Seller leads and vehicles acquisition flow (e2e)', () => {
  let app: INestApplication<App>;
  let db: Kysely<DB>;
  let authCookies: string[];

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
    await db.deleteFrom('inventory.vehicle_tracked_costs').execute();
    await db.deleteFrom('inventory.vehicle_photos').execute();
    await db.deleteFrom('inventory.vehicles').execute();
    await db.deleteFrom('crm.seller_leads').execute();
    await db.deleteFrom('authentication.sessions').execute();
    await db
      .deleteFrom('authentication.users')
      .where('email', '=', ADMIN_EMAIL)
      .execute();

    await db
      .insertInto('authentication.users')
      .values({
        email: ADMIN_EMAIL,
        password_hash: await hashPassword(PASSWORD),
        full_name: 'Acquisition Admin',
        role: 'admin',
      })
      .execute();

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
  });

  afterAll(async () => {
    await db.deleteFrom('sales.commissions').execute();
    await db.deleteFrom('sales.sales').execute();
    await db.deleteFrom('inventory.vehicle_tracked_costs').execute();
    await db.deleteFrom('inventory.vehicle_photos').execute();
    await db.deleteFrom('inventory.vehicles').execute();
    await db.deleteFrom('crm.seller_leads').execute();
    await db.deleteFrom('authentication.sessions').execute();
    await db
      .deleteFrom('authentication.users')
      .where('email', '=', ADMIN_EMAIL)
      .execute();
    await app.close();
  });

  it('rejects anonymous access to seller lead and vehicle routes', async () => {
    await request(app.getHttpServer()).get('/seller-leads').expect(401);
    await request(app.getHttpServer()).post('/vehicles').send({}).expect(401);
  });

  it('creates and updates a seller lead', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/seller-leads')
      .set('Cookie', authCookies)
      .send({
        sellerName: 'Juan Dela Cruz',
        contactNumber: '09171234567',
        email: 'juan@example.com',
        inquirySource: 'Facebook',
        vehicleBrand: 'Toyota',
        vehicleModel: 'Vios',
        vehicleYear: 2020,
        askingPrice: '550000.00',
        region: 'NCR',
        notes: 'First owner',
      })
      .expect(201);

    expect(createResponse.body).toEqual({
      sellerLead: expect.objectContaining({
        id: expect.any(String),
        sellerName: 'Juan Dela Cruz',
        status: 'New Inquiry',
      }),
    });

    const updateResponse = await request(app.getHttpServer())
      .patch(`/seller-leads/${createResponse.body.sellerLead.id}`)
      .set('Cookie', authCookies)
      .send({
        status: 'Inspection Scheduled',
        notes: 'Inspection booked for Saturday',
      })
      .expect(200);

    expect(updateResponse.body).toEqual({
      sellerLead: expect.objectContaining({
        id: createResponse.body.sellerLead.id,
        status: 'Inspection Scheduled',
        notes: 'Inspection booked for Saturday',
      }),
    });
  });

  it('stores acquisition evaluation data and returns computed recommendation summary', async () => {
    const leadResponse = await createSellerLead(app, authCookies);
    const leadId = leadResponse.body.sellerLead.id;

    await request(app.getHttpServer())
      .post(`/seller-leads/${leadId}/estimated-costs`)
      .set('Cookie', authCookies)
      .send({
        category: 'repair',
        amount: '15000.00',
        note: 'Front suspension work',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/seller-leads/${leadId}/estimated-costs`)
      .set('Cookie', authCookies)
      .send({
        category: 'reconditioning',
        amount: '8000.00',
        note: 'Paint correction and detailing',
      })
      .expect(201);

    const updateResponse = await request(app.getHttpServer())
      .patch(`/seller-leads/${leadId}`)
      .set('Cookie', authCookies)
      .send({
        status: 'Evaluated',
        targetBuyPrice: '1180000.00',
        expectedResalePrice: '1380000.00',
        targetProfitAmount: '100000.00',
        decision: 'Negotiate',
        decisionNote: 'Proceed if seller accepts target buy price.',
        inspectionCompletedAt: '2026-06-27T03:00:00.000Z',
        inspectionNotes: 'Unit runs well but suspension noise is present.',
        inspectionFindings: {
          engine: { rating: 'good', notes: 'No unusual noise' },
          transmission: { rating: 'good', notes: 'Smooth shifting' },
          suspension: { rating: 'fair', notes: 'Front knocks on bumps' },
          brakes: { rating: 'good', notes: 'Pads still usable' },
          tires: { rating: 'fair', notes: 'Will need replacement soon' },
          exterior: { rating: 'fair', notes: 'Minor scratches on rear bumper' },
          interior: { rating: 'good', notes: 'Clean cabin overall' },
          ac: { rating: 'good', notes: 'Cold air' },
          electrical: { rating: 'good', notes: 'All lights working' },
          papers: { rating: 'good', notes: 'Complete OR/CR' },
        },
      })
      .expect(200);

    expect(updateResponse.body.sellerLead).toEqual(
      expect.objectContaining({
        id: leadId,
        status: 'Evaluated',
        targetBuyPrice: '1180000.00',
        expectedResalePrice: '1380000.00',
        targetProfitAmount: '100000.00',
        decision: 'Negotiate',
        estimatedCostsTotal: '23000.00',
        estimatedTotalInvestment: '1203000.00',
        estimatedGrossProfit: '177000.00',
        estimatedProfitMargin: '12.83',
        recommendedAction: 'Buy',
        inspectionCompletedAt: '2026-06-27T03:00:00.000Z',
        inspectionNotes: 'Unit runs well but suspension noise is present.',
        inspectionFindings: expect.objectContaining({
          suspension: expect.objectContaining({
            rating: 'fair',
            notes: 'Front knocks on bumps',
          }),
        }),
        estimatedCosts: expect.arrayContaining([
          expect.objectContaining({
            category: 'repair',
            amount: '15000.00',
          }),
          expect.objectContaining({
            category: 'reconditioning',
            amount: '8000.00',
          }),
        ]),
      }),
    );

    const detailResponse = await request(app.getHttpServer())
      .get(`/seller-leads/${leadId}`)
      .set('Cookie', authCookies)
      .expect(200);

    expect(detailResponse.body.sellerLead).toEqual(
      expect.objectContaining({
        id: leadId,
        estimatedCostsTotal: '23000.00',
        estimatedTotalInvestment: '1203000.00',
        recommendedAction: 'Buy',
      }),
    );
    expect(detailResponse.body.sellerLead.estimatedCosts).toHaveLength(2);
  });

  it('requires approval before conversion and uses the approved buy price as vehicle purchase price', async () => {
    const leadResponse = await createSellerLead(app, authCookies);
    const leadId = leadResponse.body.sellerLead.id;

    await request(app.getHttpServer())
      .patch(`/seller-leads/${leadId}`)
      .set('Cookie', authCookies)
      .send({
        status: 'Evaluated',
        targetBuyPrice: '1195000.00',
        expectedResalePrice: '1400000.00',
        targetProfitAmount: '90000.00',
        decision: 'Buy',
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/seller-leads/${leadId}/convert`)
      .set('Cookie', authCookies)
      .send({
        year: 2021,
        targetSellingPrice: '1400000.00',
        minimumAcceptablePrice: '1360000.00',
        status: 'Incoming',
      })
      .expect(400);

    const approvalResponse = await request(app.getHttpServer())
      .patch(`/seller-leads/${leadId}`)
      .set('Cookie', authCookies)
      .send({
        status: 'Approved to Buy',
      })
      .expect(200);

    expect(approvalResponse.body.sellerLead).toEqual(
      expect.objectContaining({
        status: 'Approved to Buy',
        approvedToBuyAt: expect.any(String),
        approvedByUserId: expect.any(String),
      }),
    );

    const convertResponse = await request(app.getHttpServer())
      .post(`/seller-leads/${leadId}/convert`)
      .set('Cookie', authCookies)
      .send({
        year: 2021,
        targetSellingPrice: '1400000.00',
        minimumAcceptablePrice: '1360000.00',
        status: 'Incoming',
      })
      .expect(201);

    expect(convertResponse.body).toEqual({
      sellerLead: expect.objectContaining({
        id: leadId,
        status: 'Purchased',
      }),
      vehicle: expect.objectContaining({
        sellerLeadId: leadId,
        purchasePrice: '1195000.00',
      }),
    });
  });

  it('creates and deletes seller lead estimated costs while returning updated evaluation totals', async () => {
    const leadResponse = await createSellerLead(app, authCookies);
    const leadId = leadResponse.body.sellerLead.id;

    await request(app.getHttpServer())
      .patch(`/seller-leads/${leadId}`)
      .set('Cookie', authCookies)
      .send({
        targetBuyPrice: '1200000.00',
        expectedResalePrice: '1390000.00',
        targetProfitAmount: '80000.00',
      })
      .expect(200);

    const firstCostResponse = await request(app.getHttpServer())
      .post(`/seller-leads/${leadId}/estimated-costs`)
      .set('Cookie', authCookies)
      .send({
        category: 'documentation',
        amount: '2500.00',
        note: 'Transfer fees',
      })
      .expect(201);

    expect(firstCostResponse.body.sellerLead).toEqual(
      expect.objectContaining({
        estimatedCostsTotal: '2500.00',
        estimatedTotalInvestment: '1202500.00',
        estimatedGrossProfit: '187500.00',
      }),
    );

    const costId = firstCostResponse.body.sellerLead.estimatedCosts[0].id;

    const secondCostResponse = await request(app.getHttpServer())
      .post(`/seller-leads/${leadId}/estimated-costs`)
      .set('Cookie', authCookies)
      .send({
        category: 'transport',
        amount: '3500.00',
        note: 'Hauling from Bulacan',
      })
      .expect(201);

    expect(secondCostResponse.body.sellerLead).toEqual(
      expect.objectContaining({
        estimatedCostsTotal: '6000.00',
        estimatedTotalInvestment: '1206000.00',
        estimatedGrossProfit: '184000.00',
      }),
    );

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/seller-leads/${leadId}/estimated-costs/${costId}`)
      .set('Cookie', authCookies)
      .expect(200);

    expect(deleteResponse.body.sellerLead).toEqual(
      expect.objectContaining({
        estimatedCostsTotal: '3500.00',
        estimatedTotalInvestment: '1203500.00',
        estimatedGrossProfit: '186500.00',
      }),
    );
    expect(deleteResponse.body.sellerLead.estimatedCosts).toHaveLength(1);
  });

  it('converts a seller lead into a linked vehicle and marks the lead as purchased', async () => {
    const leadResponse = await createSellerLead(app, authCookies);

    await request(app.getHttpServer())
      .patch(`/seller-leads/${leadResponse.body.sellerLead.id}`)
      .set('Cookie', authCookies)
      .send({
        status: 'Approved to Buy',
        targetBuyPrice: '540000.00',
      })
      .expect(200);

    const convertResponse = await request(app.getHttpServer())
      .post(`/seller-leads/${leadResponse.body.sellerLead.id}/convert`)
      .set('Cookie', authCookies)
      .send({
        year: 2020,
        targetSellingPrice: '620000.00',
        minimumAcceptablePrice: '590000.00',
        purchasePrice: '540000.00',
        status: 'Incoming',
        photos: [{ fileUrl: 'https://example.com/photo-1.jpg', sortOrder: 0 }],
      })
      .expect(201);

    expect(convertResponse.body).toEqual({
      sellerLead: expect.objectContaining({
        id: leadResponse.body.sellerLead.id,
        status: 'Purchased',
      }),
      vehicle: expect.objectContaining({
        id: expect.any(String),
        sellerLeadId: leadResponse.body.sellerLead.id,
        stockNumber: expect.stringMatching(/^ETC-\d{4}-\d{3}$/),
        status: 'Incoming',
      }),
    });

    await request(app.getHttpServer())
      .post(`/seller-leads/${leadResponse.body.sellerLead.id}/convert`)
      .set('Cookie', authCookies)
      .send({
        year: 2020,
      })
      .expect(400);
  });

  it('blocks moving a vehicle to Available without required pricing and photos', async () => {
    const createVehicleResponse = await request(app.getHttpServer())
      .post('/vehicles')
      .set('Cookie', authCookies)
      .send({
        brand: 'Honda',
        model: 'City',
        year: 2021,
        status: 'Incoming',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/vehicles/${createVehicleResponse.body.vehicle.id}`)
      .set('Cookie', authCookies)
      .send({
        status: 'Available',
      })
      .expect(400);
  });

  it('allows moving a vehicle to Available when pricing and photos are complete', async () => {
    const createVehicleResponse = await request(app.getHttpServer())
      .post('/vehicles')
      .set('Cookie', authCookies)
      .send({
        brand: 'Mitsubishi',
        model: 'Montero',
        year: 2022,
        status: 'Incoming',
      })
      .expect(201);

    const updateResponse = await request(app.getHttpServer())
      .patch(`/vehicles/${createVehicleResponse.body.vehicle.id}`)
      .set('Cookie', authCookies)
      .send({
        status: 'Available',
        targetSellingPrice: '1500000.00',
        minimumAcceptablePrice: '1450000.00',
        photos: [{ fileUrl: 'https://example.com/photo-2.jpg', sortOrder: 0 }],
      })
      .expect(200);

    expect(updateResponse.body).toEqual({
      vehicle: expect.objectContaining({
        id: createVehicleResponse.body.vehicle.id,
        status: 'Available',
      }),
    });
  });

  it('generates sequential yearly stock numbers for direct vehicle creation', async () => {
    const firstResponse = await request(app.getHttpServer())
      .post('/vehicles')
      .set('Cookie', authCookies)
      .send({
        brand: 'Toyota',
        model: 'Vios',
        year: 2020,
        status: 'Incoming',
      })
      .expect(201);

    const secondResponse = await request(app.getHttpServer())
      .post('/vehicles')
      .set('Cookie', authCookies)
      .send({
        brand: 'Honda',
        model: 'Civic',
        year: 2021,
        status: 'Incoming',
      })
      .expect(201);

    expect(firstResponse.body.vehicle.stockNumber).toMatch(/^ETC-\d{4}-001$/);
    expect(secondResponse.body.vehicle.stockNumber).toMatch(/^ETC-\d{4}-002$/);
  });

  it('creates and deletes tracked vehicle costs while returning the running total', async () => {
    const vehicleResponse = await request(app.getHttpServer())
      .post('/vehicles')
      .set('Cookie', authCookies)
      .send({ brand: 'Mazda', model: 'CX-5', year: 2023, status: 'Incoming' })
      .expect(201);
    const vehicleId = vehicleResponse.body.vehicle.id;

    const firstCostResponse = await request(app.getHttpServer())
      .post(`/vehicles/${vehicleId}/tracked-costs`)
      .set('Cookie', authCookies)
      .send({ category: 'repair', amount: '12500.50', note: 'Brake service' })
      .expect(201);

    expect(firstCostResponse.body.vehicle).toEqual(
      expect.objectContaining({
        trackedCostsTotal: '12500.50',
        trackedCosts: [
          expect.objectContaining({
            category: 'repair',
            amount: '12500.50',
            note: 'Brake service',
          }),
        ],
      }),
    );

    const secondCostResponse = await request(app.getHttpServer())
      .post(`/vehicles/${vehicleId}/tracked-costs`)
      .set('Cookie', authCookies)
      .send({
        category: 'detailing',
        amount: '2500.00',
        note: 'Interior detailing',
      })
      .expect(201);

    expect(secondCostResponse.body.vehicle.trackedCostsTotal).toBe('15000.50');

    const firstCostId = firstCostResponse.body.vehicle.trackedCosts[0].id;
    const deleteResponse = await request(app.getHttpServer())
      .delete(`/vehicles/${vehicleId}/tracked-costs/${firstCostId}`)
      .set('Cookie', authCookies)
      .expect(200);

    expect(deleteResponse.body.vehicle.trackedCostsTotal).toBe('2500.00');
    expect(deleteResponse.body.vehicle.trackedCosts).toHaveLength(1);
  });

  it('filters vehicles by status when requested', async () => {
    await request(app.getHttpServer())
      .post('/vehicles')
      .set('Cookie', authCookies)
      .send({
        brand: 'Toyota',
        model: 'Raize',
        year: 2023,
        status: 'Available',
        targetSellingPrice: '980000.00',
        minimumAcceptablePrice: '940000.00',
        photos: [{ fileUrl: 'https://example.com/raize.jpg', sortOrder: 0 }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/vehicles')
      .set('Cookie', authCookies)
      .send({
        brand: 'Ford',
        model: 'Everest',
        year: 2022,
        status: 'Incoming',
      })
      .expect(201);

    const availableResponse = await request(app.getHttpServer())
      .get('/vehicles?status=Available')
      .set('Cookie', authCookies)
      .expect(200);

    expect(availableResponse.body.vehicles).toHaveLength(1);
    expect(availableResponse.body.vehicles[0]).toEqual(
      expect.objectContaining({
        status: 'Available',
        brand: 'Toyota',
        model: 'Raize',
      }),
    );

    const unfilteredResponse = await request(app.getHttpServer())
      .get('/vehicles')
      .set('Cookie', authCookies)
      .expect(200);

    expect(unfilteredResponse.body.vehicles).toHaveLength(2);
  });
});

async function createSellerLead(
  app: INestApplication<App>,
  authCookies: string[],
) {
  return request(app.getHttpServer())
    .post('/seller-leads')
    .set('Cookie', authCookies)
    .send({
      sellerName: 'Maria Santos',
      contactNumber: '09179998888',
      inquirySource: 'Walk-in',
      vehicleBrand: 'Toyota',
      vehicleModel: 'Fortuner',
      vehicleYear: 2021,
      askingPrice: '1300000.00',
      region: 'Bulacan',
      notes: 'Rush sale',
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
