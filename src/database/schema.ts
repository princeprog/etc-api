import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

export type RoleName = 'admin' | 'staff';
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
  | 'Negotiating'
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
export type FollowUpStatus = 'Due' | 'Completed' | 'Overdue';
export type LeadType = 'seller' | 'buyer';
export type VehicleTrackedCostCategory =
  | 'reconditioning'
  | 'repair'
  | 'detailing'
  | 'transport'
  | 'documentation'
  | 'miscellaneous';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  full_name: string;
  role: RoleName;
  must_change_password: Generated<boolean>;
  active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
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

export interface DB {
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
  'sales.sales': SalesTable;
  'sales.commissions': CommissionsTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

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
