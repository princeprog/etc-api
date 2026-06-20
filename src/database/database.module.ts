import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { DB } from './db';
import { DATABASE } from './database.constants';

const databaseProvider = {
  provide: DATABASE,
  useFactory: () => {
    const host = requireEnv('DB_HOST');
    const port = requireEnv('DB_PORT');
    const user = requireEnv('DB_USER');
    const password = requireEnv('DB_PASSWORD');
    const database = requireEnv('DB_NAME');

    const pool = new Pool({
      host,
      port: Number(port),
      user,
      password,
      database,
    });

    return new Kysely<DB>({
      dialect: new PostgresDialect({ pool }),
    });
  },
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

@Global()
@Module({
  providers: [databaseProvider],
  exports: [databaseProvider],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
