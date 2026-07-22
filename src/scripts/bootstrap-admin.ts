import 'dotenv/config';

import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { DB } from '../database/db.js';
import { hashPassword } from '../common/utils/auth.utils.js';

async function bootstrapAdmin() {
  const db = createDb();

  try {
    const existingUsers = await db
      .selectFrom('authentication.users')
      .select(({ fn }) => fn.count<string>('id').as('count'))
      .executeTakeFirstOrThrow();

    if (Number(existingUsers.count) > 0) {
      throw new Error(
        'Bootstrap admin creation is disabled because authentication.users already contains records',
      );
    }

    const email = requireEnv('BOOTSTRAP_ADMIN_EMAIL').trim().toLowerCase();
    const password = requireEnv('BOOTSTRAP_ADMIN_PASSWORD');
    const fullName = requireEnv('BOOTSTRAP_ADMIN_FULL_NAME').trim();
    const administratorRole = await db
      .selectFrom('authentication.roles')
      .select(['id'])
      .where('name', '=', 'Administrator')
      .where('archived_at', 'is', null)
      .executeTakeFirstOrThrow();

    const insertedUser = await db
      .insertInto('authentication.users')
      .values({
        email,
        password_hash: await hashPassword(password),
        full_name: fullName,
        role: 'admin',
        role_id: administratorRole.id,
      })
      .returning(['id', 'email', 'full_name'])
      .executeTakeFirstOrThrow();

    console.log('Bootstrap admin created successfully');
    console.log(`ID: ${insertedUser.id}`);
    console.log(`Email: ${insertedUser.email}`);
    console.log(`Full name: ${insertedUser.full_name}`);
  } finally {
    await db.destroy();
  }
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

bootstrapAdmin().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown bootstrap admin error';
  console.error(message);
  process.exitCode = 1;
});
