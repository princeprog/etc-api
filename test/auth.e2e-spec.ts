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

const ADMIN_EMAIL = 'admin.e2e@example.com';
const STAFF_EMAIL = 'staff.e2e@example.com';
const NEW_STAFF_EMAIL = 'new.staff@example.com';
const PASSWORD = 'Password123!';

describe('Auth flows (e2e)', () => {
  let app: INestApplication<App>;
  let db: Kysely<DB>;

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
    await db.deleteFrom('auth.sessions').execute();
    await db
      .deleteFrom('auth.users')
      .where('email', 'in', [ADMIN_EMAIL, STAFF_EMAIL, NEW_STAFF_EMAIL])
      .execute();

    const [adminPasswordHash, staffPasswordHash] = await Promise.all([
      hashPassword(PASSWORD),
      hashPassword(PASSWORD),
    ]);

    await db
      .insertInto('auth.users')
      .values([
        {
          email: ADMIN_EMAIL,
          password_hash: adminPasswordHash,
          full_name: 'Admin E2E',
          role: 'admin',
        },
        {
          email: STAFF_EMAIL,
          password_hash: staffPasswordHash,
          full_name: 'Staff E2E',
          role: 'staff',
        },
      ])
      .execute();
  });

  afterAll(async () => {
    await db.deleteFrom('auth.sessions').execute();
    await db
      .deleteFrom('auth.users')
      .where('email', 'in', [ADMIN_EMAIL, STAFF_EMAIL, NEW_STAFF_EMAIL])
      .execute();
    await app.close();
  });

  it('rejects anonymous access to protected routes', async () => {
    await request(app.getHttpServer()).get('/').expect(401);
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('logs in and returns the current user from http-only cookies', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: ADMIN_EMAIL,
        password: PASSWORD,
      })
      .expect(201);

    const accessCookie = extractCookie(
      loginResponse.headers['set-cookie'],
      'etc_access_token',
    );
    const refreshCookie = extractCookie(
      loginResponse.headers['set-cookie'],
      'etc_refresh_token',
    );
    const rawAccessCookie = extractRawCookie(
      loginResponse.headers['set-cookie'],
      'etc_access_token',
    );
    const rawRefreshCookie = extractRawCookie(
      loginResponse.headers['set-cookie'],
      'etc_refresh_token',
    );

    expect(rawAccessCookie).toContain('HttpOnly');
    expect(rawRefreshCookie).toContain('HttpOnly');

    const meResponse = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', [accessCookie, refreshCookie])
      .expect(200);

    expect(meResponse.body).toEqual({
      user: {
        id: expect.any(String),
        email: ADMIN_EMAIL,
        fullName: 'Admin E2E',
        role: 'admin',
      },
    });
  });

  it('rotates refresh tokens, revokes the previous access token, and enforces logout', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: ADMIN_EMAIL,
        password: PASSWORD,
      })
      .expect(201);

    const initialAccessCookie = extractCookie(
      loginResponse.headers['set-cookie'],
      'etc_access_token',
    );
    const initialRefreshCookie = extractCookie(
      loginResponse.headers['set-cookie'],
      'etc_refresh_token',
    );

    const refreshResponse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [initialRefreshCookie])
      .expect(201);

    const rotatedAccessCookie = extractCookie(
      refreshResponse.headers['set-cookie'],
      'etc_access_token',
    );
    const rotatedRefreshCookie = extractCookie(
      refreshResponse.headers['set-cookie'],
      'etc_refresh_token',
    );

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', [initialAccessCookie, rotatedRefreshCookie])
      .expect(401);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', [rotatedAccessCookie, rotatedRefreshCookie])
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [initialRefreshCookie])
      .expect(401);

    const logoutResponse = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', [rotatedRefreshCookie])
      .expect(201);

    expect(logoutResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('etc_access_token=;'),
        expect.stringContaining('etc_refresh_token=;'),
      ]),
    );

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', [rotatedAccessCookie, rotatedRefreshCookie])
      .expect(401);
  });

  it('enforces admin-only access', async () => {
    const staffLoginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: STAFF_EMAIL,
        password: PASSWORD,
      })
      .expect(201);

    const staffAccessCookie = extractCookie(
      staffLoginResponse.headers['set-cookie'],
      'etc_access_token',
    );
    const staffRefreshCookie = extractCookie(
      staffLoginResponse.headers['set-cookie'],
      'etc_refresh_token',
    );

    await request(app.getHttpServer())
      .get('/auth/admin-check')
      .set('Cookie', [staffAccessCookie, staffRefreshCookie])
      .expect(403);

    const adminLoginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: ADMIN_EMAIL,
        password: PASSWORD,
      })
      .expect(201);

    const adminAccessCookie = extractCookie(
      adminLoginResponse.headers['set-cookie'],
      'etc_access_token',
    );
    const adminRefreshCookie = extractCookie(
      adminLoginResponse.headers['set-cookie'],
      'etc_refresh_token',
    );

    await request(app.getHttpServer())
      .get('/auth/admin-check')
      .set('Cookie', [adminAccessCookie, adminRefreshCookie])
      .expect(200);
  });

  it('allows admins to create users with roles and rejects staff access', async () => {
    const staffLoginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: STAFF_EMAIL,
        password: PASSWORD,
      })
      .expect(201);

    const staffAccessCookie = extractCookie(
      staffLoginResponse.headers['set-cookie'],
      'etc_access_token',
    );
    const staffRefreshCookie = extractCookie(
      staffLoginResponse.headers['set-cookie'],
      'etc_refresh_token',
    );

    await request(app.getHttpServer())
      .post('/auth/users')
      .set('Cookie', [staffAccessCookie, staffRefreshCookie])
      .send({
        email: NEW_STAFF_EMAIL,
        password: PASSWORD,
        fullName: 'New Staff User',
        role: 'staff',
      })
      .expect(403);

    const adminLoginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: ADMIN_EMAIL,
        password: PASSWORD,
      })
      .expect(201);

    const adminAccessCookie = extractCookie(
      adminLoginResponse.headers['set-cookie'],
      'etc_access_token',
    );
    const adminRefreshCookie = extractCookie(
      adminLoginResponse.headers['set-cookie'],
      'etc_refresh_token',
    );

    const createResponse = await request(app.getHttpServer())
      .post('/auth/users')
      .set('Cookie', [adminAccessCookie, adminRefreshCookie])
      .send({
        email: NEW_STAFF_EMAIL,
        password: PASSWORD,
        fullName: 'New Staff User',
        role: 'staff',
      })
      .expect(201);

    expect(createResponse.body).toEqual({
      user: {
        id: expect.any(String),
        email: NEW_STAFF_EMAIL,
        fullName: 'New Staff User',
        role: 'staff',
      },
    });

    await request(app.getHttpServer())
      .post('/auth/users')
      .set('Cookie', [adminAccessCookie, adminRefreshCookie])
      .send({
        email: NEW_STAFF_EMAIL,
        password: PASSWORD,
        fullName: 'Duplicate User',
        role: 'staff',
      })
      .expect(400);
  });
});

function extractCookie(
  rawCookies: string[] | undefined,
  cookieName: string,
): string {
  const cookie = extractRawCookie(rawCookies, cookieName);
  return cookie.split(';')[0];
}

function extractRawCookie(
  rawCookies: string[] | undefined,
  cookieName: string,
): string {
  const cookie = rawCookies?.find((value) =>
    value.startsWith(`${cookieName}=`),
  );

  if (!cookie) {
    throw new Error(`Missing cookie ${cookieName}`);
  }

  return cookie;
}
