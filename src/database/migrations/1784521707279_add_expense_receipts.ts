import type { Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('finance.expenses')
    .addColumn('receipt_file_url', 'text')
    .addColumn('receipt_public_id', 'varchar(255)')
    .addColumn('receipt_original_filename', 'varchar(255)')
    .addColumn('receipt_mime_type', 'varchar(120)')
    .addColumn('receipt_file_size', 'integer')
    .addColumn('receipt_uploaded_at', 'timestamptz')
    .addColumn('receipt_uploaded_by_user_id', 'uuid', (col) =>
      col
        .references('authentication.users.id')
        .onDelete('set null')
        .onUpdate('cascade'),
    )
    .execute();
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('finance.expenses')
    .dropColumn('receipt_uploaded_by_user_id')
    .dropColumn('receipt_uploaded_at')
    .dropColumn('receipt_file_size')
    .dropColumn('receipt_mime_type')
    .dropColumn('receipt_original_filename')
    .dropColumn('receipt_public_id')
    .dropColumn('receipt_file_url')
    .execute();
}
