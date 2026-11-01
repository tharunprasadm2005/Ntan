export type Role =
  | 'owner'
  | 'company_admin'
  | 'warehouse_manager'
  | 'warehouse_supervisor'
  | 'receiving_operator'
  | 'quality_inspector'
  | 'putaway_operator'
  | 'material_handler'
  | 'inventory_controller'
  | 'replenishment_operator'
  | 'order_picker'
  | 'packing_operator'
  | 'dispatch_operator'
  | 'logistics_coordinator'
  | 'cycle_counter'
  | 'returns_operator'
  | 'viewer'
  | 'auditor'
  | 'picker_packer'
  | 'warehouse_operator'
  | 'inventory_manager'
  | 'project_manager'
  | 'technician'
  | 'purchasing'
  | (string & {});

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
}

export type InventoryModel = 'internal' | '3pl' | 'hybrid';

export interface Company {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  status: string;
  inventory_model: InventoryModel;
  allow_over_receipt?: boolean;
  created_at: string;
  updated_at: string;
}

export type PartnerRole = 'supplier' | 'customer' | '3pl_client';

export interface PartnerAddress {
  name?: string | null;
  type?: 'shipping' | 'billing' | 'delivery' | 'pickup' | 'receiving' | 'returns' | 'operational';
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postal_code?: string | null;
  country: string;
}

export interface PartnerContact {
  name: string;
  department?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  is_primary?: boolean;
}

export interface Client {
  id: string;
  company_id: string;
  code: string;
  name: string;
  display_name?: string | null;
  types: PartnerRole[];
  contact_name: string | null;
  contact_email: string | null;
  contact_phone?: string | null;
  contacts?: PartnerContact[];
  tax_id?: string | null;
  billing_address?: PartnerAddress | null;
  addresses?: PartnerAddress[];
  notes?: string | null;
  is_internal: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PartnerImportRow {
  row_number: number;
  code: string;
  name: string;
  display_name?: string | null;
  types: PartnerRole[];
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  contacts?: PartnerContact[];
  tax_id?: string | null;
  billing_address?: PartnerAddress | null;
  addresses?: PartnerAddress[];
  notes?: string | null;
  status: string;
  is_valid: boolean;
  is_duplicate: boolean;
  existing_partner_id?: string | null;
  errors: string[];
  warnings: string[];
}

export interface PartnerImportPreviewResponse {
  total_rows: number;
  valid_count: number;
  invalid_count: number;
  duplicate_count: number;
  warnings_count: number;
  rows: PartnerImportRow[];
}

export interface PartnerImportConfirmRequest {
  rows: PartnerImportRow[];
  duplicate_strategy: 'skip' | 'update';
}

export interface PartnerImportConfirmResponse {
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  errors: string[];
}

export interface Membership {
  id: string;
  company_id: string;
  user_id: string;
  company_name: string | null;
  role: Role;
  location_ids: string[];
  warehouse_ids?: string[];
  client_ids: string[];
  status: string;
  valid_from?: string | null;
  valid_until?: string | null;
  department?: string | null;
  job_title?: string | null;
  employee_id?: string | null;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface AuthResponse extends TokenPair {
  user: User;
  company: Company;
  membership: Membership;
}

export interface Session {
  user: User;
  company: Company;
  membership: Membership;
  clients: Client[];
  permissions: string[];
}

export interface Member {
  id: string;
  user_id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: Role;
  role_label: string;
  is_custom_role?: boolean;
  location_ids: string[];
  warehouse_ids?: string[];
  client_ids: string[];
  status: string;
  valid_from?: string | null;
  valid_until?: string | null;
  department?: string | null;
  job_title?: string | null;
  employee_id?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface MemberListResponse {
  members: Member[];
  total?: number;
  total_count?: number;
}

export interface PermissionItem {
  key: string;
  label: string;
  description: string;
}

export interface PermissionCategory {
  category: string;
  description: string;
  permissions: PermissionItem[];
}

export interface RoleDefinition {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  permissions: string[];
  is_custom: boolean;
  is_system?: boolean;
  assigned_count?: number;
  assigned_members_count?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CustomRoleInput {
  name: string;
  slug?: string;
  description?: string;
  permissions: string[];
}

export interface RecentActivityItem {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  action_label: string;
  entity: string;
  entity_id: string;
  target_name?: string | null;
  details?: Record<string, any>;
  created_at: string;
}

export interface TeamOverview {
  total_members: number;
  active_members: number;
  pending_invitations: number;
  attention_invitations: number;
  suspended_members: number;
  inactive_members: number;
  distinct_warehouses_count: number;
  custom_roles_count: number;
  recent_activity: RecentActivityItem[];
}

export interface InvitationPreview {
  company_name: string;
  email: string;
  role: Role;
  role_label: string;
  expires_at: string;
  inviter_name?: string | null;
  name?: string | null;
  phone?: string | null;
  department?: string | null;
  job_title?: string | null;
  employee_id?: string | null;
}

export interface Invitation {
  id: string;
  name?: string | null;
  email: string;
  role: Role;
  role_label: string;
  is_custom_role?: boolean;
  location_ids: string[];
  warehouse_ids?: string[];
  client_ids: string[];
  status: string;
  invite_code?: string | null;
  email_delivery_status?: string;
  email_delivery_error?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  department?: string | null;
  job_title?: string | null;
  employee_id?: string | null;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
}

export interface CreatedInvitation extends Invitation {
  invitation_token?: string | null;
  invite_code?: string | null;
}

export type BulkInvitationStatus =
  | 'created'
  | 'already_member'
  | 'pending_invitation'
  | 'failed';

export interface BulkInvitationResult {
  email: string;
  status: 'created' | 'already_member' | 'pending_invitation' | 'failed';
  message: string | null;
  invitation: CreatedInvitation | null;
}

export interface BulkInvitationResponse {
  results: BulkInvitationResult[];
  total_count: number;
  created_count: number;
  skipped_count: number;
}

export interface ExcelImportRowPreview {
  row_number: number;
  row_index: number;
  name: string;
  email: string;
  role: string;
  role_label: string;
  warehouse_codes: string[];
  warehouse_names: string[];
  phone?: string | null;
  employee_id?: string | null;
  job_title?: string | null;
  department?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  is_valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface UserCheckResponse {
  exists: boolean;
  is_active: boolean;
  email: string;
}

export interface ExcelImportPreviewResponse {
  total_rows: number;
  valid_count?: number;
  valid_rows: number;
  invalid_count?: number;
  invalid_rows: number;
  duplicate_count?: number;
  duplicate_rows: number;
  existing_member_count?: number;
  existing_members: number;
  pending_invitation_count?: number;
  pending_invitations: number;
  warnings_count?: number;
  warnings: string[];
  rows: ExcelImportRowPreview[];
}

export interface ExcelImportConfirmRow {
  name: string;
  email: string;
  role: string;
  warehouse_codes?: string[];
  phone?: string | null;
  employee_id?: string | null;
  job_title?: string | null;
  department?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
}

export interface ExcelImportConfirmRequest {
  rows: ExcelImportConfirmRow[];
  send_emails?: boolean;
}

export interface ExcelImportResultItem {
  row_number: number;
  email: string;
  status: 'created' | 'skipped' | 'failed';
  message?: string | null;
  invite_code?: string | null;
  email_delivery_status?: string;
}

export interface ExcelImportConfirmResponse {
  total_processed: number;
  created_count: number;
  skipped_count: number;
  failed_count: number;
  results: ExcelImportResultItem[];
}

export interface AcceptInvitationInput {
  invitation_token: string;
  email: string;
  name: string;
  password: string;
  phone?: string;
}

export interface ItemPreferredLocation {
  warehouse_id: string;
  warehouse_code?: string | null;
  warehouse_name?: string | null;
  location_id: string;
  location_code: string;
  location_path?: string | null;
  zone?: string | null;
  aisle?: string | null;
  rack?: string | null;
  shelf?: string | null;
  bin?: string | null;
  storage_type?: string | null;
  is_primary?: boolean;
}

export interface Item {
  id: string;
  company_id: string | null;
  client_id: string | null;
  sku: string;
  name: string;
  barcode: string | null;
  description: string | null;
  category: string | null;
  item_type: string;
  base_uom: string;
  tracking_mode: string;
  expiry_tracked: boolean;
  cost: string | null;
  reorder_point: string | null;
  status: string;
  supplier_count?: number;
  preferred_supplier_id?: string | null;
  preferred_supplier_name?: string | null;
  preferred_locations?: ItemPreferredLocation[];
  created_at: string;
  updated_at: string;
}

export type SupplierMappingStatus = 'active' | 'inactive';

export interface ItemSupplier {
  id: string;
  company_id: string;
  item_id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_code?: string | null;
  supplier_status: string;
  supplier_is_active: boolean;
  supplier_types: PartnerRole[];
  supplier_sku: string;
  purchase_price: string | null;
  currency: string;
  lead_time_days: number | null;
  min_order_qty: string | null;
  is_preferred: boolean;
  status: SupplierMappingStatus;
  created_at: string;
  updated_at: string;
}

export interface ItemSupplierList {
  item_id: string;
  suppliers: ItemSupplier[];
}

export interface ItemSupplierInput {
  supplier_id: string;
  supplier_sku: string;
  purchase_price?: string | null;
  currency?: string;
  lead_time_days?: number | null;
  min_order_qty?: string | null;
  is_preferred?: boolean;
  status?: SupplierMappingStatus;
}

export interface ItemSupplierUpdateInput {
  supplier_sku?: string;
  purchase_price?: string | null;
  currency?: string | null;
  lead_time_days?: number | null;
  min_order_qty?: string | null;
  is_preferred?: boolean;
  status?: SupplierMappingStatus;
}

export interface SupplierItem {
  mapping_id: string;
  item_id: string;
  item_sku: string;
  item_name: string;
  item_category: string | null;
  item_base_uom: string;
  item_status: string;
  item_client_id: string | null;
  supplier_sku: string;
  purchase_price: string | null;
  currency: string;
  lead_time_days: number | null;
  min_order_qty: string | null;
  is_preferred: boolean;
  status: SupplierMappingStatus;
  last_delivery_at: string | null;
  delivered_qty: string;
  delivery_count: number;
  last_receipt_id: string | null;
  last_receipt_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierItemList {
  supplier_id: string;
  items: SupplierItem[];
}

export interface ItemList {
  items: Item[];
  next_cursor: string | null;
}

export interface ItemUpdateInput {
  name?: string;
  barcode?: string | null;
  description?: string | null;
  category?: string | null;
  expiry_tracked?: boolean;
  cost?: string | null;
  reorder_point?: string | null;
  status?: 'active' | 'archived';
  preferred_locations?: ItemPreferredLocation[];
}

export interface BulkImportItemRow {
  sku: string;
  name: string;
  barcode?: string;
  description?: string;
  category?: string;
  item_type?: string;
  base_uom?: string;
  tracking_mode?: 'none' | 'lot' | 'serial';
  expiry_tracked?: boolean;
  cost?: string;
  reorder_point?: string;
  status?: 'active' | 'archived';
  warehouse_code?: string;
  zone_code?: string;
  aisle_code?: string;
  rack_code?: string;
  shelf_code?: string;
  bin_code?: string;
  storage_type?: string;
  preferred_location?: string;
}

export interface BulkImportInput {
  client_id?: string;
  mode?: 'upsert' | 'create_only';
  csv_data?: string;
  file_base64?: string;
  file_name?: string;
  items?: BulkImportItemRow[];
}

export interface BulkImportError {
  row: number;
  sku?: string | null;
  field?: string | null;
  message: string;
}

export interface BulkImportResponse {
  total_rows: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
  errors: BulkImportError[];
}

export interface Lot {
  id: string;
  company_id: string;
  client_id: string | null;
  item_id: string;
  sku: string | null;
  item_name: string | null;
  lot_no: string;
  expiry_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface LotList {
  lots: Lot[];
  next_cursor: string | null;
}

export interface Serial {
  id: string;
  company_id: string;
  client_id: string | null;
  item_id: string;
  sku: string | null;
  item_name: string | null;
  serial_no: string;
  lot_id: string | null;
  lot_no: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SerialList {
  serials: Serial[];
  next_cursor: string | null;
}

export type ScanResultType = 'item' | 'location' | 'lot' | 'serial';

export interface ScanResolveResult {
  type: ScanResultType;
  code: string;
  item: Item | null;
  location: Location | null;
  lot: Lot | null;
  serial: Serial | null;
}

export type WarehouseType =
  | 'general'
  | 'distribution'
  | 'fulfilment'
  | 'bulk'
  | 'cold_storage'
  | 'cross_dock';

export type WarehouseLayout = 'all_in_one' | 'multi_zone' | 'bulk_storage';

export interface Warehouse {
  id: string;
  code?: string | null;
  name: string;
  address: string | null;
  warehouse_type?: string | null;
  warehouse_layout?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: string;
  warehouse_id: string;
  parent_id: string | null;
  code: string;
  name?: string | null;
  path: string | null;
  barcode: string | null;
  type: string;
  is_pickable: boolean;
  status: 'active' | 'blocked' | 'archived' | string;
  zone?: string | null;
  aisle?: string | null;
  rack?: string | null;
  shelf?: string | null;
  bin?: string | null;
  capacity?: string | number | null;
  preferred_items?: { item_id: string; sku: string; name: string; is_primary?: boolean }[];
  actual_stock_qty?: string | number | null;
  created_at: string;
  updated_at: string;
}

export interface InitialLocationCreate {
  code: string;
  name?: string | null;
  type: string;
  is_pickable?: boolean;
  parent_code?: string | null;
  zone?: string | null;
  aisle?: string | null;
  rack?: string | null;
  shelf?: string | null;
  bin?: string | null;
  barcode?: string | null;
  status?: 'active' | 'blocked' | 'archived';
}

export interface BulkLocationGenerateRequest {
  warehouse_id: string;
  parent_id?: string | null;
  prefix?: string | null;
  aisle_start?: number;
  aisle_end?: number;
  rack_start?: number;
  rack_end?: number;
  shelf_start?: number;
  shelf_end?: number;
  bin_start?: number;
  bin_end?: number;
  separator?: string;
  zero_pad?: number;
  type?: string;
  is_pickable?: boolean;
  preview_only?: boolean;
}

export interface BulkLocationPreviewItem {
  code: string;
  path: string;
  aisle: string;
  rack: string;
  shelf: string;
  bin: string;
  is_duplicate: boolean;
  status: 'ready' | 'duplicate' | 'error';
  error?: string | null;
}

export interface BulkLocationGenerateResponse {
  preview_only: boolean;
  total_generated: number;
  new_count: number;
  duplicate_count: number;
  locations: BulkLocationPreviewItem[];
  created_count: number;
}

export interface WarehouseTemplateLocationPreview {
  code: string;
  path: string;
  type: string;
  is_pickable: boolean;
  description: string;
}

export interface WarehouseTemplateApplyResponse {
  warehouse_id: string;
  warehouse_layout: WarehouseLayout;
  preview_only: boolean;
  locations: WarehouseTemplateLocationPreview[];
  created_count: number;
}

export interface Balance {
  id: string;
  company_id: string | null;
  client_id: string | null;
  item_id: string;
  sku: string | null;
  item_name: string | null;
  warehouse_id: string;
  location_id: string;
  lot_id: string | null;
  lot_no: string | null;
  serial_id: string | null;
  serial_no: string | null;
  expiry_date: string | null;
  stock_status: string;
  on_hand: string;
  reserved: string;
  blocked: string;
  available: string;
  version: number;
  updated_at: string;
}

export interface BalanceList {
  balances: Balance[];
  next_cursor: string | null;
}

export type ReorderUrgency = 'stockout' | 'critical' | 'low';

export interface ReorderSupplierOption {
  supplier_id: string;
  supplier_name: string;
  supplier_sku: string | null;
  is_preferred: boolean;
  purchase_price: string | null;
  currency: string | null;
  lead_time_days: number | null;
  min_order_qty: string | null;
}

export interface ReorderNeedRow {
  item_id: string;
  sku: string;
  item_name: string;
  client_id: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  base_uom: string;
  on_hand: string;
  reserved: string;
  blocked: string;
  available: string;
  incoming_qty: string;
  incoming_source: 'purchase_order' | 'unsupported';
  projected_stock: string;
  reorder_point: string;
  target_stock: string;
  target_stock_source: 'item' | 'fallback';
  suggested_qty: string;
  urgency: ReorderUrgency;
  preferred_supplier_id?: string | null;
  preferred_supplier_name?: string | null;
  needs_supplier_assignment?: boolean;
  supplier_options?: ReorderSupplierOption[];
}

export interface ReorderNeededResponse {
  generated_at: string;
  rows: ReorderNeedRow[];
  assumptions: string[];
}

export type PurchaseOrderStatus = 'open' | 'partially_received' | 'received' | 'cancelled';

export interface PurchaseOrderLine {
  id: string;
  item_id: string;
  sku: string;
  supplier_sku?: string | null;
  item_name: string;
  uom: string;
  base_uom: string;
  ordered_qty: string;
  received_qty: string;
  remaining_qty: string;
}

export interface PurchaseOrder {
  id: string;
  company_id: string;
  client_id: string | null;
  number: string;
  status: PurchaseOrderStatus;
  warehouse_id: string;
  supplier_id: string;
  supplier_name: string;
  expected_date: string | null;
  note: string | null;
  line_count: number;
  ordered_qty: string;
  received_qty: string;
  remaining_qty: string;
  lines: PurchaseOrderLine[];
  created_at: string;
  updated_at: string;
  received_at: string | null;
  cancelled_at: string | null;
}

export interface PurchaseOrderList {
  orders: PurchaseOrder[];
  next_cursor: string | null;
}

export interface CreatePurchaseOrderInput {
  client_id?: string;
  supplier_id: string;
  warehouse_id: string;
  expected_date?: string;
  note?: string;
  lines: Array<{ item_id: string; qty: string }>;
}

export interface Movement {
  id: string;
  company_id: string | null;
  client_id: string | null;
  type: string;
  item_id: string;
  sku: string | null;
  item_name: string | null;
  quantity_delta: string;
  uom: string;
  base_qty: string;
  from_location_id: string | null;
  to_location_id: string | null;
  lot_id: string | null;
  lot_no: string | null;
  serial_id: string | null;
  serial_no: string | null;
  expiry_date: string | null;
  stock_status: string;
  source_type: string;
  source_id: string;
  source_number: string;
  actor_id: string;
  device_id: string | null;
  occurred_at: string;
  recorded_at: string;
  reason: string | null;
  reversal_of: string | null;
  idempotency_key: string;
}

export interface MovementList {
  movements: Movement[];
  next_cursor: string | null;
}

export interface DashboardWindow {
  inbound_units: string;
  outbound_units: string;
  net_units: string;
  movement_count: number;
}

export interface DashboardReceivingQueue {
  draft_count: number;
  draft_units: string;
  oldest_draft_at: string | null;
}

export interface DashboardSummary {
  as_of: string;
  timezone: string;
  today: DashboardWindow;
  last_7_days: DashboardWindow;
  receiving_queue: DashboardReceivingQueue;
}

export interface ReceiptLine {
  id: string;
  item_id: string;
  sku: string;
  supplier_sku?: string | null;
  item_name: string;
  qty: string;
  uom: string;
  base_qty: string;
  base_uom: string;
  location_id: string;
  lot_id: string | null;
  lot_no: string | null;
  expiry_date: string | null;
  serial_no: string | null;
  serial_numbers: string[];
  discrepancy_reason: string | null;
  purchase_order_line_id: string | null;
}

export interface Receipt {
  id: string;
  company_id: string | null;
  client_id: string | null;
  number: string;
  status: string;
  warehouse_id: string;
  location_id: string;
  supplier_id: string | null;
  supplier: string | null;
  purchase_order: string | null;
  purchase_order_id: string | null;
  note: string | null;
  delivery_note: string | null;
  discrepancy_reason: string | null;
  putaway_required: boolean;
  putaway_completed_at: string | null;
  lines: ReceiptLine[];
  created_at: string;
  updated_at: string;
  committed_at: string | null;
}

export interface ReceiptList {
  receipts: Receipt[];
  next_cursor: string | null;
}

export interface CreateReceiptInput {
  client_id?: string;
  supplier_id?: string;
  warehouse_id: string;
  location_id: string;
  supplier?: string;
  purchase_order?: string;
  purchase_order_id?: string;
  note?: string;
  delivery_note?: string;
  discrepancy_reason?: string;
  lines: Array<{
    item_id: string;
    qty: string;
    uom?: string;
    lot_id?: string;
    lot_no?: string;
    expiry_date?: string;
    serial_numbers?: string[];
    discrepancy_reason?: string;
  }>;
}

export interface PutawayPlacement {
  location_id: string;
  location_code: string;
  quantity: string;
  moved_at: string;
  moved_by: string | null;
}

export interface PutawayTask {
  id: string;
  company_id: string;
  client_id: string | null;
  receipt_id: string;
  receipt_number: string;
  line_id: string;
  warehouse_id: string;
  item_id: string;
  sku: string;
  item_name: string;
  qty: string;
  uom: string;
  base_qty: string;
  base_uom: string;
  lot_id: string | null;
  lot_no: string | null;
  expiry_date: string | null;
  serial_id: string | null;
  serial_no: string | null;
  tracking_mode: string;
  supplier_id: string | null;
  supplier_name: string | null;
  purchase_order_id: string | null;
  purchase_order: string | null;
  from_location_id: string;
  from_location_code: string;
  to_location_id: string | null;
  to_location_code: string | null;
  suggested_location_id?: string | null;
  suggested_location_code?: string | null;
  suggested_location_path?: string | null;
  completed_qty: string;
  remaining_qty: string;
  placements: PutawayPlacement[];
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  completed_by: string | null;
}

export interface ChecklistItemResult {
  category: string;
  item: string;
  status: 'passed' | 'failed' | 'na';
  measurement?: string | null;
  notes?: string | null;
}

export interface InspectionSubmitInput {
  receipt_id: string;
  line_id: string;
  item_id: string;
  passed_qty: number;
  rejected_qty: number;
  on_hold_qty: number;
  checklist: ChecklistItemResult[];
  defect_photos?: string[];
  notes?: string | null;
  destination_location_id?: string | null;
}

export interface InspectionQueueItem {
  id: string;
  receipt_id: string;
  receipt_number: string;
  line_id: string;
  supplier_id?: string | null;
  supplier?: string | null;
  purchase_order_id?: string | null;
  purchase_order?: string | null;
  item_id: string;
  sku: string;
  product_name: string;
  warehouse_id: string;
  warehouse_name: string;
  received_quantity: number | string;
  pending_quantity: number | string;
  passed_quantity: number | string;
  rejected_quantity: number | string;
  on_hold_quantity: number | string;
  inspection_status: string;
  receipt_date: string;
  suggested_location_id?: string | null;
  suggested_location_code?: string | null;
}

export interface InspectionRecord {
  id: string;
  receipt_id: string;
  receipt_number: string;
  line_id: string;
  item_id: string;
  sku: string;
  product_name: string;
  warehouse_id: string;
  passed_qty: number | string;
  rejected_qty: number | string;
  on_hold_qty: number | string;
  status: string;
  checklist: ChecklistItemResult[];
  defect_photos: string[];
  notes?: string | null;
  inspector_id: string;
  inspector_name?: string | null;
  created_at: string;
}

export interface InspectionTemplatesResponse {
  categories: Array<{
    category: string;
    items: string[];
  }>;
  custom_templates?: unknown[];
}

export interface PutawayTaskList {
  tasks: PutawayTask[];
  next_cursor: string | null;
}

export interface CreateLocationInput {
  warehouse_id: string;
  parent_id?: string;
  code: string;
  type: string;
  is_pickable?: boolean;
}

export type SyncOperationStatus = 'applied' | 'duplicate' | 'rejected';

export interface SyncOperation {
  operation_id: string;
  type: string;
  client_id?: string;
  entity_id?: string;
  occurred_at?: string;
  payload: Record<string, unknown>;
}

export interface SyncOperationResult {
  operation_id: string;
  status: SyncOperationStatus;
  event_sequence: number | null;
  error_code: string | null;
  message: string | null;
}

export interface SyncPushResponse {
  results: SyncOperationResult[];
  latest_sequence: number;
  server_time: string;
}

export interface SyncEvent {
  sequence: number;
  entity_type: string;
  entity_id: string;
  action: string;
  client_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export interface SyncPullResponse {
  events: SyncEvent[];
  next_cursor: number;
  latest_sequence: number;
  has_more: boolean;
}

export interface OutboundOrderLine {
  id: string;
  item_id: string;
  sku: string;
  item_name: string;
  qty: string;
  uom: string;
  base_qty: string;
  base_uom: string;
}

export interface OutboundAllocation {
  id: string;
  line_id: string;
  item_id: string;
  sku: string;
  item_name: string;
  location_id: string;
  location_code: string;
  lot_id: string | null;
  lot_no: string | null;
  expiry_date: string | null;
  serial_id: string | null;
  serial_no: string | null;
  qty: string;
  base_qty: string;
  base_uom: string;
  status: string;
  picked_at: string | null;
  picked_by: string | null;
}

export interface OutboundOrder {
  id: string;
  company_id: string;
  client_id: string | null;
  number: string;
  status: string;
  warehouse_id: string;
  customer_name: string;
  customer_reference: string | null;
  note: string | null;
  lines: OutboundOrderLine[];
  allocations: OutboundAllocation[];
  created_at: string;
  updated_at: string;
  allocated_at: string | null;
  shipped_at: string | null;
  cancelled_at: string | null;
}

export interface OutboundOrderList {
  orders: OutboundOrder[];
  next_cursor: string | null;
}

export interface CreateOutboundOrderInput {
  client_id?: string;
  customer_id?: string;
  warehouse_id: string;
  customer_name: string;
  customer_reference?: string;
  note?: string;
  lines: Array<{ item_id: string; qty: string }>;
}

export interface TransferLine {
  id: string;
  item_id: string;
  sku: string;
  item_name: string;
  qty: string;
  uom: string;
  base_qty: string;
  base_uom: string;
  lot_id: string | null;
  lot_no: string | null;
  expiry_date: string | null;
  serial_id: string | null;
  serial_no: string | null;
  serial_numbers: string[];
}

export interface Transfer {
  id: string;
  company_id: string;
  client_id: string | null;
  number: string;
  status: string;
  transfer_type: string;
  from_warehouse_id: string;
  from_location_id: string;
  to_warehouse_id: string;
  to_location_id: string;
  note: string | null;
  reason: string | null;
  lines: TransferLine[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  dispatched_at: string | null;
  dispatched_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
}

export interface TransferListResponse {
  transfers: Transfer[];
  next_cursor: string | null;
}

export interface CreateTransferInput {
  client_id?: string | null;
  from_warehouse_id: string;
  from_location_id: string;
  to_warehouse_id: string;
  to_location_id: string;
  note?: string | null;
  reason?: string | null;
  lines: Array<{
    item_id: string;
    qty: string;
    uom?: string | null;
    lot_id?: string | null;
    lot_no?: string | null;
    expiry_date?: string | null;
    serial_numbers?: string[];
  }>;
}

