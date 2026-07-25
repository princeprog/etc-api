export type PermissionScope = 'assigned' | 'all';

export const ADMINISTRATOR_ROLE_NAME = 'Administrator';
export const STAFF_ROLE_NAME = 'Staff';

export const PERMISSIONS = {
  dashboardView: 'dashboard.view',
  sellerLeadsView: 'seller_leads.view',
  sellerLeadsCreate: 'seller_leads.create',
  sellerLeadsUpdate: 'seller_leads.update',
  sellerLeadsDelete: 'seller_leads.delete',
  sellerLeadsConvert: 'seller_leads.convert',
  buyerLeadsView: 'buyer_leads.view',
  buyerLeadsCreate: 'buyer_leads.create',
  buyerLeadsUpdate: 'buyer_leads.update',
  buyerLeadsDelete: 'buyer_leads.delete',
  vehiclesView: 'vehicles.view',
  vehiclesCreate: 'vehicles.create',
  vehiclesUpdate: 'vehicles.update',
  vehiclesDelete: 'vehicles.delete',
  vehicleCatalogManage: 'vehicle_catalog.manage',
  inspectionChecklistsManage: 'inspection_checklists.manage',
  inspectionsView: 'inspections.view',
  inspectionsUpdate: 'inspections.update',
  followUpsView: 'follow_ups.view',
  followUpsCreate: 'follow_ups.create',
  followUpsUpdate: 'follow_ups.update',
  salesView: 'sales.view',
  salesCreate: 'sales.create',
  salesUpdate: 'sales.update',
  reportsView: 'reports.view',
  expenseReportsView: 'expense_reports.view',
  expensesView: 'expenses.view',
  expensesCreate: 'expenses.create',
  expensesUpdate: 'expenses.update',
  expenseCategoriesManage: 'expense_categories.manage',
  activityHistoryView: 'activity_history.view',
  usersManage: 'users.manage',
  rolesManage: 'roles.manage',
  financingView: 'financing.view',
  financingCreate: 'financing.create',
  financingUpdate: 'financing.update',
  financingReview: 'financing.review',
  financingDecide: 'financing.decide',
  financingRecordLoanRelease: 'financing.record_loan_release',
  financingRecordVehicleRelease: 'financing.record_vehicle_release',
  financingManagePartners: 'financing.manage_partners',
  financingManageTemplates: 'financing.manage_templates',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export function hasPermission(
  permissions: Record<string, PermissionScope> | undefined,
  permission: string,
): boolean {
  return Boolean(permissions?.[permission]);
}

export function hasAllPermission(
  permissions: Record<string, PermissionScope> | undefined,
  permission: string,
): boolean {
  return permissions?.[permission] === 'all';
}
