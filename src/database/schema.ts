import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

export type RoleName = 'admin' | 'staff';
export type PermissionScope = 'assigned' | 'all';
export type VehicleStatus =
  | 'Incoming'
  | 'Reconditioning'
  | 'Available'
  | 'Reserved'
  | 'Sold';
export type SellerLeadStatus =
  | 'New Inquiry'
  | 'Contacted'
  | 'Inspection Scheduled'
  | 'Evaluated'
  | 'Negotiating'
  | 'Approved to Buy'
  | 'Purchased'
  | 'Rejected';
export type BuyerLeadStatus =
  | 'New Inquiry'
  | 'Contacted'
  | 'Interested'
  | 'Negotiating'
  | 'Reserved'
  | 'Won'
  | 'Lost';
export type FollowUpStatus = 'Due' | 'Completed' | 'Overdue' | 'Cancelled';
export type LeadType = 'seller' | 'buyer';
export type VehicleTrackedCostCategory =
  | 'reconditioning'
  | 'repair'
  | 'detailing'
  | 'transport'
  | 'documentation'
  | 'miscellaneous';
export type SellerLeadDecision = 'Buy' | 'Negotiate' | 'Walk Away';
export type InspectionItemRating = 'excellent' | 'good' | 'fair' | 'poor';
export type ExpenseFrequency = 'one_time' | 'weekly' | 'monthly' | 'yearly';
export type ExpenseRuleFrequency = Exclude<ExpenseFrequency, 'one_time'>;
export type ExpenseSettlementStatus = 'unpaid' | 'paid' | 'void';
export type ExpenseDisplayStatus =
  | 'upcoming'
  | 'due_soon'
  | 'due_today'
  | 'unpaid'
  | 'paid'
  | 'overdue'
  | 'void';
export type ExpenseNotificationType =
  | 'expense_due_soon'
  | 'expense_due_today'
  | 'expense_overdue';
export type FollowUpNotificationType =
  | 'follow_up_due_soon'
  | 'follow_up_due_today'
  | 'follow_up_overdue';
export type VehicleNotificationType = 'vehicle_available';
export type NotificationType =
  | ExpenseNotificationType
  | FollowUpNotificationType
  | VehicleNotificationType;
export type FinancingApplicationStatus =
  | 'draft'
  | 'collecting_requirements'
  | 'under_review'
  | 'needs_revision'
  | 'approved'
  | 'rejected'
  | 'loan_released'
  | 'vehicle_released'
  | 'cancelled';
export type FinancingRequirementStatus =
  | 'pending'
  | 'submitted'
  | 'accepted'
  | 'revision_requested';
export type SalePaymentMode = 'cash' | 'financing';

export interface SellerLeadInspectionItem {
  rating: InspectionItemRating;
  notes: string | null;
}

export interface SellerLeadInspectionFindings {
  engine?: SellerLeadInspectionItem;
  transmission?: SellerLeadInspectionItem;
  suspension?: SellerLeadInspectionItem;
  brakes?: SellerLeadInspectionItem;
  tires?: SellerLeadInspectionItem;
  exterior?: SellerLeadInspectionItem;
  interior?: SellerLeadInspectionItem;
  ac?: SellerLeadInspectionItem;
  electrical?: SellerLeadInspectionItem;
  papers?: SellerLeadInspectionItem;
}
export type ActivityEntityType =
  | 'seller_lead'
  | 'buyer_lead'
  | 'vehicle'
  | 'sale'
  | 'follow_up'
  | 'user'
  | 'financing_application'
  | 'expense'
  | 'expense_category'
  | 'expense_recurring_rule';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  full_name: string;
  role: RoleName;
  role_id: string;
  must_change_password: Generated<boolean>;
  active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RolesTable {
  id: Generated<string>;
  name: string;
  description: string | null;
  is_system: Generated<boolean>;
  is_mutable: Generated<boolean>;
  archived_at: Date | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  revision: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PermissionsTable {
  key: string;
  module: string;
  action: string;
  label: string;
  description: string | null;
  supports_assigned_scope: Generated<boolean>;
  sort_order: number;
  created_at: Generated<Date>;
}

export interface RolePermissionsTable {
  role_id: string;
  permission_key: string;
  scope: PermissionScope;
  created_at: Generated<Date>;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  refresh_token_hash: string;
  current_access_token_jti: string;
  expires_at: Date;
  last_rotated_at: Generated<Date>;
  revoked_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface VehiclesTable {
  id: Generated<string>;
  stock_number: string;
  brand: string;
  model: string;
  year: number;
  variant: string | null;
  mileage: number | null;
  transmission: string | null;
  fuel_type: string | null;
  color: string | null;
  region: string | null;
  features: string | null;
  remarks: string | null;
  purchase_price: string | null;
  target_selling_price: string | null;
  minimum_acceptable_price: string | null;
  acquisition_source: string | null;
  seller_lead_id: string | null;
  status: VehicleStatus;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface VehiclePhotosTable {
  id: Generated<string>;
  vehicle_id: string;
  file_url: string;
  sort_order: Generated<number>;
  created_at: Generated<Date>;
}

export interface VehicleTrackedCostsTable {
  id: Generated<string>;
  vehicle_id: string;
  category: VehicleTrackedCostCategory;
  amount: string;
  note: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SellerLeadsTable {
  id: Generated<string>;
  seller_name: string;
  contact_number: string;
  email: string | null;
  facebook_name: string | null;
  inquiry_source: string | null;
  vehicle_brand: string;
  vehicle_model: string;
  vehicle_year: number | null;
  vehicle_variant: string | null;
  asking_price: string | null;
  region: string | null;
  notes: string | null;
  inspection_completed_at: Date | null;
  inspection_notes: string | null;
  inspection_findings: SellerLeadInspectionFindings | null;
  decision: SellerLeadDecision | null;
  decision_note: string | null;
  approved_to_buy_at: Date | null;
  approved_by_user_id: string | null;
  status: SellerLeadStatus;
  assignee_user_id: string | null;
  latest_activity_at: Date | null;
  closing_note: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface BuyerLeadsTable {
  id: Generated<string>;
  buyer_name: string;
  contact_number: string;
  email: string | null;
  facebook_name: string | null;
  inquiry_source: string | null;
  desired_budget: string | null;
  notes: string | null;
  status: BuyerLeadStatus;
  assignee_user_id: string | null;
  latest_activity_at: Date | null;
  closing_note: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface LeadVehicleLinksTable {
  id: Generated<string>;
  buyer_lead_id: string;
  vehicle_id: string;
  created_at: Generated<Date>;
}

export interface LeadActivitiesTable {
  id: Generated<string>;
  lead_type: LeadType;
  seller_lead_id: string | null;
  buyer_lead_id: string | null;
  activity_type: string;
  note: string;
  performed_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface FollowUpsTable {
  id: Generated<string>;
  lead_type: LeadType;
  seller_lead_id: string | null;
  buyer_lead_id: string | null;
  assignee_user_id: string;
  due_at: Date;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  status: FollowUpStatus;
  note: string;
  outcome_note: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SalesTable {
  id: Generated<string>;
  sale_number: string;
  vehicle_id: string;
  buyer_lead_id: string;
  created_by_user_id: string;
  agent_name: string | null;
  sale_date: Date;
  final_sale_amount: string;
  gross_profit_amount: string | null;
  commission_method: string | null;
  commission_locked: Generated<boolean>;
  payment_mode: Generated<SalePaymentMode>;
  financing_application_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SaleDraftsTable {
  id: Generated<string>;
  draft_number: string;
  vehicle_id: string;
  buyer_lead_id: string;
  created_by_user_id: string;
  agent_name: string | null;
  sale_date: Date | null;
  final_sale_amount: string | null;
  commission_override_amount: string | null;
  commission_override_reason: string | null;
  buyer_closing_note: string | null;
  payment_mode: Generated<SalePaymentMode>;
  financing_application_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CommissionsTable {
  id: Generated<string>;
  sale_id: string;
  agent_name: string | null;
  default_amount: string | null;
  override_amount: string | null;
  final_amount: string;
  override_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ActivityHistoryTable {
  id: Generated<string>;
  actor_user_id: string | null;
  actor_display_name: string | null;
  entity_type: ActivityEntityType;
  entity_id: string;
  action_type: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: Generated<Date>;
}

export interface ExpenseCategoriesTable {
  id: Generated<string>;
  name: string;
  description: string | null;
  is_default: Generated<boolean>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ExpenseRecurringRulesTable {
  id: Generated<string>;
  title: string;
  category_id: string;
  expected_amount: string;
  frequency: ExpenseRuleFrequency;
  due_day: number;
  start_date: Date;
  end_date: Date | null;
  vendor_name: string | null;
  assigned_staff_id: string | null;
  notes: string | null;
  is_active: Generated<boolean>;
  created_by_user_id: string;
  updated_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ExpensesTable {
  id: Generated<string>;
  recurring_rule_id: string | null;
  billing_period_key: string | null;
  title: string;
  category_id: string;
  expected_amount: string;
  actual_paid_amount: string | null;
  expense_date: Date | null;
  due_date: Date;
  paid_at: Date | null;
  status: ExpenseSettlementStatus;
  vendor_name: string | null;
  assigned_staff_id: string | null;
  payment_method: string | null;
  reference_number: string | null;
  notes: string | null;
  voided_at: Date | null;
  void_reason: string | null;
  receipt_file_url: string | null;
  receipt_public_id: string | null;
  receipt_original_filename: string | null;
  receipt_mime_type: string | null;
  receipt_file_size: number | null;
  receipt_uploaded_at: Date | null;
  receipt_uploaded_by_user_id: string | null;
  created_by_user_id: string;
  updated_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface FinancingPartnersTable {
  id: Generated<string>;
  name: string;
  contact_person: string | null;
  contact_number: string | null;
  email: string | null;
  notes: string | null;
  is_active: Generated<boolean>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface FinancingPartnerRepresentativesTable {
  id: Generated<string>;
  partner_id: string;
  user_id: string;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface FinancingRequirementTemplatesTable {
  id: Generated<string>;
  partner_id: string;
  name: string;
  description: string | null;
  is_default: Generated<boolean>;
  is_active: Generated<boolean>;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface FinancingRequirementTemplateItemsTable {
  id: Generated<string>;
  template_id: string;
  label: string;
  description: string | null;
  is_required: Generated<boolean>;
  sort_order: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface FinancingApplicationsTable {
  id: Generated<string>;
  application_number: string;
  buyer_lead_id: string;
  vehicle_id: string;
  assigned_staff_user_id: string;
  partner_id: string;
  representative_user_id: string;
  template_id: string | null;
  status: Generated<FinancingApplicationStatus>;
  requested_amount: string | null;
  down_payment: string | null;
  term_months: number | null;
  decision_note: string | null;
  decided_by_user_id: string | null;
  decided_at: Date | null;
  released_loan_amount: string | null;
  loan_released_at: Date | null;
  loan_release_reference: string | null;
  loan_released_by_user_id: string | null;
  vehicle_released_at: Date | null;
  vehicle_release_note: string | null;
  vehicle_released_by_user_id: string | null;
  cancelled_at: Date | null;
  cancelled_by_user_id: string | null;
  cancellation_reason: string | null;
  created_by_user_id: string;
  updated_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface FinancingApplicationRequirementsTable {
  id: Generated<string>;
  application_id: string;
  template_item_id: string | null;
  label: string;
  description: string | null;
  is_required: Generated<boolean>;
  sort_order: Generated<number>;
  status: Generated<FinancingRequirementStatus>;
  revision_reason: string | null;
  review_note: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface FinancingDocumentVersionsTable {
  id: Generated<string>;
  requirement_id: string;
  version_number: number;
  file_public_id: string;
  file_resource_type: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  is_current: Generated<boolean>;
  uploaded_by_user_id: string | null;
  uploaded_by_public_session_id: string | null;
  created_at: Generated<Date>;
}

export interface FinancingUploadLinksTable {
  id: Generated<string>;
  application_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface FinancingUploadVerificationAttemptsTable {
  id: Generated<string>;
  upload_link_id: string;
  ip_address: string;
  succeeded: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface NotificationsTable {
  id: Generated<string>;
  recipient_user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  entity_type: string;
  entity_id: string;
  due_date_snapshot: Date | null;
  deduplication_key: string;
  read_at: Date | null;
  resolved_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DB {
  'authentication.permissions': PermissionsTable;
  'authentication.role_permissions': RolePermissionsTable;
  'authentication.roles': RolesTable;
  'authentication.users': UsersTable;
  'authentication.sessions': SessionsTable;
  'inventory.vehicles': VehiclesTable;
  'inventory.vehicle_photos': VehiclePhotosTable;
  'inventory.vehicle_tracked_costs': VehicleTrackedCostsTable;
  'crm.seller_leads': SellerLeadsTable;
  'crm.buyer_leads': BuyerLeadsTable;
  'crm.lead_vehicle_links': LeadVehicleLinksTable;
  'crm.lead_activities': LeadActivitiesTable;
  'crm.follow_ups': FollowUpsTable;
  'sales.sale_drafts': SaleDraftsTable;
  'sales.sales': SalesTable;
  'sales.commissions': CommissionsTable;
  'ops.activity_history': ActivityHistoryTable;
  'ops.notifications': NotificationsTable;
  'finance.expense_categories': ExpenseCategoriesTable;
  'finance.expense_recurring_rules': ExpenseRecurringRulesTable;
  'finance.expenses': ExpensesTable;
  'finance.financing_partners': FinancingPartnersTable;
  'finance.financing_partner_representatives': FinancingPartnerRepresentativesTable;
  'finance.financing_requirement_templates': FinancingRequirementTemplatesTable;
  'finance.financing_requirement_template_items': FinancingRequirementTemplateItemsTable;
  'finance.financing_applications': FinancingApplicationsTable;
  'finance.financing_application_requirements': FinancingApplicationRequirementsTable;
  'finance.financing_document_versions': FinancingDocumentVersionsTable;
  'finance.financing_upload_links': FinancingUploadLinksTable;
  'finance.financing_upload_verification_attempts': FinancingUploadVerificationAttemptsTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Role = Selectable<RolesTable>;
export type NewRole = Insertable<RolesTable>;
export type RoleUpdate = Updateable<RolesTable>;
export type Permission = Selectable<PermissionsTable>;
export type RolePermission = Selectable<RolePermissionsTable>;

export type Session = Selectable<SessionsTable>;
export type NewSession = Insertable<SessionsTable>;
export type SessionUpdate = Updateable<SessionsTable>;

export type Vehicle = Selectable<VehiclesTable>;
export type NewVehicle = Insertable<VehiclesTable>;
export type VehicleUpdate = Updateable<VehiclesTable>;
export type VehicleTrackedCost = Selectable<VehicleTrackedCostsTable>;
export type NewVehicleTrackedCost = Insertable<VehicleTrackedCostsTable>;
export type VehicleTrackedCostUpdate = Updateable<VehicleTrackedCostsTable>;

export type SellerLead = Selectable<SellerLeadsTable>;
export type NewSellerLead = Insertable<SellerLeadsTable>;
export type SellerLeadUpdate = Updateable<SellerLeadsTable>;

export type BuyerLead = Selectable<BuyerLeadsTable>;
export type NewBuyerLead = Insertable<BuyerLeadsTable>;
export type BuyerLeadUpdate = Updateable<BuyerLeadsTable>;

export type ExpenseCategory = Selectable<ExpenseCategoriesTable>;
export type NewExpenseCategory = Insertable<ExpenseCategoriesTable>;
export type ExpenseCategoryUpdate = Updateable<ExpenseCategoriesTable>;

export type ExpenseRecurringRule = Selectable<ExpenseRecurringRulesTable>;
export type NewExpenseRecurringRule = Insertable<ExpenseRecurringRulesTable>;
export type ExpenseRecurringRuleUpdate = Updateable<ExpenseRecurringRulesTable>;

export type Expense = Selectable<ExpensesTable>;
export type NewExpense = Insertable<ExpensesTable>;
export type ExpenseUpdate = Updateable<ExpensesTable>;

export type Notification = Selectable<NotificationsTable>;
export type NewNotification = Insertable<NotificationsTable>;
export type NotificationUpdate = Updateable<NotificationsTable>;

export type FinancingPartner = Selectable<FinancingPartnersTable>;
export type NewFinancingPartner = Insertable<FinancingPartnersTable>;
export type FinancingPartnerUpdate = Updateable<FinancingPartnersTable>;
export type FinancingApplication = Selectable<FinancingApplicationsTable>;
export type NewFinancingApplication = Insertable<FinancingApplicationsTable>;
export type FinancingApplicationUpdate = Updateable<FinancingApplicationsTable>;
