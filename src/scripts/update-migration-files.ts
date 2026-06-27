import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Client, type ClientConfig } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables from .env or .env.local
dotenv.config();

// Folder where migrations are stored
const migrationsDir = path.join(process.cwd(), 'src/database/migrations');

// Kysely migration template
const template = `import type { Kysely } from 'kysely'

// \`any\` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	// up migration code goes here...
	// note: up migrations are mandatory. you must implement this function.
	// For more info, see: https://kysely.dev/docs/migrations
}

// \`any\` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	// down migration code goes here...
	// note: down migrations are optional. you can safely delete this function.
	// For more info, see: https://kysely.dev/docs/migrations
}
`;

async function repairMigrations(): Promise<void> {
  let client: Client | undefined;
  try {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      console.error('❌ DATABASE_URL not found in environment variables.');
      process.exit(1);
    }

    // Connect to DB
    const pgConfig: ClientConfig = { connectionString };
    pgConfig.ssl = process.env.DB_SSL === 'true';

    
    client = new Client(pgConfig);
    await client.connect();
    console.log('✅ Connected to database.');

    // 1. Check and cleanup local files (remove exact template stubs)
    await fs.mkdir(migrationsDir, { recursive: true });
    const localFiles = await fs.readdir(migrationsDir);
    const templateFiles = localFiles.filter(f => f.endsWith('.ts'));

    const deletedStubs: string[] = [];
    for (const filename of templateFiles) {
      const filePath = path.join(migrationsDir, filename);
      const content = await fs.readFile(filePath, 'utf-8');
      // Normalize line endings for cross-platform comparison
      const normalizedContent = content.replace(/\r\n/g, '\n');
      const normalizedTemplate = template.replace(/\r\n/g, '\n');

      if (normalizedContent === normalizedTemplate) {
        await fs.unlink(filePath);
        deletedStubs.push(filename);
      }
    }

    if (deletedStubs.length > 0) {
      console.log(`🧹 Deleted ${deletedStubs.length} template migration stub(s):`);
      deletedStubs.forEach(f => console.log(`   ➜ ${f}`));
    }

    // 2. Query executed migrations
    const res = await client.query<{ name: string }>('SELECT name FROM kysely_migration');
    const dbMigrations = res.rows.map(row => row.name);
    console.log(`🔎 Found ${dbMigrations.length} migration records in database.`);

    // 3. Check local files again after cleanup
    const localFilesAfterCleanup = await fs.readdir(migrationsDir);
    const localMigrations = localFilesAfterCleanup
      .filter(f => f.endsWith('.ts'))
      .map(f => f.replace('.ts', ''));

    // 4. Identify missing migrations
    const missing = dbMigrations.filter(m => !localMigrations.includes(m));

    if (missing.length === 0) {
      console.log('✨ No missing migration files found.');
      return;
    }

    console.log(`⚠️ Found ${missing.length} missing migration files. Recreating...`);

    // 5. Recreate missing files
    for (const name of missing) {
      const filename = `${name}.ts`;
      const filePath = path.join(migrationsDir, filename);
      await fs.writeFile(filePath, template);
      console.log(`   🛠️ Recreated: ${filename}`);
    }

    console.log(`\n✅ Successfully repaired ${missing.length} migration files.`);
    console.log('🚀 You can now run "pnpm migrate:latest" safely.');

  } catch (err) {
    console.error('❌ Error repairing migrations:', err);
    process.exit(1);
  } finally {
    if (client) {
      await client.end();
    }
  }
}

repairMigrations();
