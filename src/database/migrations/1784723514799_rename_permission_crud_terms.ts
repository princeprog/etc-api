import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    update authentication.permissions as permissions
    set
      action = updates.action,
      label = updates.label,
      description = updates.description
    from (values
      ('dashboard.view', 'read', 'Read dashboard', 'Read dealership dashboard metrics.'),
      ('seller_leads.view', 'read', 'Read seller leads', 'Read seller lead records.'),
      ('seller_leads.create', 'write', 'Write seller leads', 'Write new seller lead records.'),
      ('seller_leads.update', 'update', 'Update seller leads', 'Update seller lead details and assignment.'),
      ('seller_leads.delete', 'delete', 'Delete seller leads', 'Delete seller lead records when supported.'),
      ('buyer_leads.view', 'read', 'Read buyer leads', 'Read buyer lead records.'),
      ('buyer_leads.create', 'write', 'Write buyer leads', 'Write new buyer lead records.'),
      ('buyer_leads.update', 'update', 'Update buyer leads', 'Update buyer lead details and assignment.'),
      ('buyer_leads.delete', 'delete', 'Delete buyer leads', 'Delete buyer lead records when supported.'),
      ('vehicles.view', 'read', 'Read vehicles', 'Read vehicle inventory records.'),
      ('vehicles.create', 'write', 'Write vehicles', 'Write vehicles to inventory.'),
      ('vehicles.update', 'update', 'Update vehicles', 'Update vehicle information and pricing.'),
      ('vehicles.delete', 'delete', 'Delete vehicles', 'Delete vehicle records when supported.'),
      ('inspections.view', 'read', 'Read inspections', 'Read seller lead inspection records.'),
      ('inspections.update', 'update', 'Update inspections', 'Update inspection drafts and completed inspections.'),
      ('follow_ups.view', 'read', 'Read follow-ups', 'Read follow-up queues and records.'),
      ('follow_ups.create', 'write', 'Write follow-ups', 'Write new scheduled follow-ups.'),
      ('follow_ups.update', 'update', 'Update follow-ups', 'Update, complete, or cancel follow-ups.'),
      ('sales.view', 'read', 'Read sales', 'Read sales and draft sale records.'),
      ('sales.create', 'write', 'Write sales', 'Write sale drafts and finalized transactions.'),
      ('sales.update', 'update', 'Update sales', 'Update sale drafts and finalize transactions.'),
      ('reports.view', 'read', 'Read reports', 'Read operational and sales reports.'),
      ('expense_reports.view', 'read', 'Read expense reports', 'Read expense analytics and exports.'),
      ('expenses.view', 'read', 'Read expenses', 'Read bill and expense records.'),
      ('expenses.create', 'write', 'Write expenses', 'Write bills and recurring expense rules.'),
      ('expenses.update', 'update', 'Update expenses', 'Update bills, receipts, voids, and recurring rules.'),
      ('activity_history.view', 'read', 'Read activity history', 'Read audit trail events.'),
      ('users.manage', 'manage', 'Manage users', 'Write users and update account status.'),
      ('roles.manage', 'manage', 'Manage roles', 'Write roles and update role access levels.')
    ) as updates(key, action, label, description)
    where permissions.key = updates.key
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    update authentication.permissions as permissions
    set
      action = updates.action,
      label = updates.label,
      description = updates.description
    from (values
      ('dashboard.view', 'view', 'View dashboard', 'Access dealership dashboard metrics.'),
      ('seller_leads.view', 'view', 'View seller leads', 'Open seller lead records.'),
      ('seller_leads.create', 'create', 'Create seller leads', 'Add new seller lead records.'),
      ('seller_leads.update', 'update', 'Edit seller leads', 'Update seller lead details and assignment.'),
      ('seller_leads.delete', 'delete', 'Delete seller leads', 'Remove seller lead records when supported.'),
      ('buyer_leads.view', 'view', 'View buyer leads', 'Open buyer lead records.'),
      ('buyer_leads.create', 'create', 'Create buyer leads', 'Add new buyer lead records.'),
      ('buyer_leads.update', 'update', 'Edit buyer leads', 'Update buyer lead details and assignment.'),
      ('buyer_leads.delete', 'delete', 'Delete buyer leads', 'Remove buyer lead records when supported.'),
      ('vehicles.view', 'view', 'View vehicles', 'Access vehicle inventory records.'),
      ('vehicles.create', 'create', 'Create vehicles', 'Add vehicles to inventory.'),
      ('vehicles.update', 'update', 'Edit vehicles', 'Update vehicle information and pricing.'),
      ('vehicles.delete', 'delete', 'Delete vehicles', 'Remove vehicle records when supported.'),
      ('inspections.view', 'view', 'View inspections', 'Open seller lead inspection records.'),
      ('inspections.update', 'update', 'Edit inspections', 'Save inspection drafts and completed inspections.'),
      ('follow_ups.view', 'view', 'View follow-ups', 'Access follow-up queues and records.'),
      ('follow_ups.create', 'create', 'Create follow-ups', 'Schedule new follow-ups.'),
      ('follow_ups.update', 'update', 'Edit follow-ups', 'Complete, cancel, or update follow-ups.'),
      ('sales.view', 'view', 'View sales', 'Access sales and draft sale records.'),
      ('sales.create', 'create', 'Create sales', 'Create sale drafts and finalized transactions.'),
      ('sales.update', 'update', 'Edit sales', 'Update sale drafts and finalize transactions.'),
      ('reports.view', 'view', 'View reports', 'Open operational and sales reports.'),
      ('expense_reports.view', 'view', 'View expense reports', 'Open expense analytics and exports.'),
      ('expenses.view', 'view', 'View expenses', 'Open bill and expense records.'),
      ('expenses.create', 'create', 'Create expenses', 'Record bills and recurring expense rules.'),
      ('expenses.update', 'update', 'Edit expenses', 'Mark bills paid, upload receipts, void bills, and update rules.'),
      ('activity_history.view', 'view', 'View activity history', 'Review audit trail events.'),
      ('users.manage', 'manage', 'Manage users', 'Create users and update account status.'),
      ('roles.manage', 'manage', 'Manage roles', 'Create roles and configure role access levels.')
    ) as updates(key, action, label, description)
    where permissions.key = updates.key
  `.execute(db);
}
