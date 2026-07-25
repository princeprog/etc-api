import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    alter table ops.notifications
    drop constraint notifications_type_check
  `.execute(db);

  await sql`
    alter table ops.notifications
    add constraint notifications_type_check
    check (
      type in (
        'expense_due_soon',
        'expense_due_today',
        'expense_overdue',
        'follow_up_due_soon',
        'follow_up_due_today',
        'follow_up_overdue',
        'vehicle_available',
        'financing_requirements_submitted',
        'financing_revision_requested',
        'financing_approved',
        'financing_rejected',
        'financing_loan_released'
      )
    )
  `.execute(db);
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    alter table ops.notifications
    drop constraint notifications_type_check
  `.execute(db);

  await sql`
    alter table ops.notifications
    add constraint notifications_type_check
    check (
      type in (
        'expense_due_soon',
        'expense_due_today',
        'expense_overdue',
        'follow_up_due_soon',
        'follow_up_due_today',
        'follow_up_overdue',
        'vehicle_available'
      )
    )
  `.execute(db);
}
