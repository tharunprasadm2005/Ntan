import { Platform } from 'react-native';

import type {
  AcceptInvitationInput,
  AuthResponse,
  BalanceList,
  BulkImportInput,
  BulkImportResponse,
  BulkInvitationResponse,
  BulkLocationGenerateRequest,
  BulkLocationGenerateResponse,
  Client,
  CreateReceiptInput,
  CreatedInvitation,
  CustomRoleInput,
  DashboardSummary,
  ExcelImportConfirmRequest,
  ExcelImportConfirmResponse,
  ExcelImportPreviewResponse,
  InitialLocationCreate,
  Invitation,
  InvitationPreview,
  InspectionQueueItem,
  InspectionRecord,
  InspectionSubmitInput,
  InspectionTemplatesResponse,
  Item,
  ItemList,
  ItemSupplier,
  ItemSupplierInput,
  ItemSupplierList,
  ItemSupplierUpdateInput,
  ItemUpdateInput,
  SupplierItemList,
  Location,
  LotList,
  Member,
  MemberListResponse,
  CreateOutboundOrderInput,
  CreatePurchaseOrderInput,
  MovementList,
  OutboundOrder,
  OutboundOrderList,
  PartnerAddress,
  PartnerContact,
  PartnerImportConfirmRequest,
  PartnerImportConfirmResponse,
  PartnerImportPreviewResponse,
  PartnerRole,
  PermissionCategory,
  PurchaseOrder,
  PurchaseOrderList,
  PutawayTask,
  PutawayTaskList,
  Receipt,
  ReceiptList,
  ReorderNeededResponse,
  RoleDefinition,
  ScanResolveResult,
  SerialList,
  Session,
  SyncOperation,
  SyncPullResponse,
  SyncPushResponse,
  TeamOverview,
  TokenPair,
  Transfer,
  TransferListResponse,
  CreateTransferInput,
  User,
  Warehouse,
  WarehouseTemplateApplyResponse,
} from './types';

const defaultBaseUrl =
  Platform.OS === 'android'
    ? 'http://10.0.2.2:8000/api/v1'
    : 'http://localhost:8000/api/v1';

const rawBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? defaultBaseUrl;
export const API_BASE_URL = (() => {
  let url = rawBaseUrl;
  if (Platform.OS === 'web' && /:\/\/10\.0\.2\.2(:\d+)?(\/|$)/.test(url)) {
    url = url.replace('10.0.2.2', 'localhost');
  } else if (Platform.OS === 'android' && /:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url)) {
    url = url.replace(/:\/\/(127\.0\.0\.1|localhost)/, '://10.0.2.2');
  }
  return url.replace(/\/$/, '');
})();

function clientQuery(clientId: string | null | undefined): string {
  if (!clientId || clientId.toLowerCase() === 'all' || clientId === '*') {
    return '';
  }
  return `&client_id=${encodeURIComponent(clientId)}`;
}

const REQUEST_TIMEOUT_MS = 30000;
const networkHint =
  Platform.OS === 'android'
    ? ' On Android 17+, allow local network access for Expo Go.'
    : '';

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    field_errors?: Record<string, string>;
    retryable?: boolean;
  };
}

export class ApiError extends Error {
  status: number;
  code: string;
  fieldErrors: Record<string, string>;
  retryable: boolean;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors: Record<string, string> = {},
    retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.retryable = retryable;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
  retried?: boolean;
}

class ApiClient {
  accessToken: string | null = null;
  refreshToken: string | null = null;
  onTokens: ((tokens: TokenPair) => void) | null = null;
  onAuthFailure: (() => void) | null = null;
  private refreshPromise: Promise<TokenPair> | null = null;

  setTokens(accessToken: string | null, refreshToken: string | null) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const auth = options.auth ?? true;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (options.body !== undefined && !isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    if (auth && this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
        method,
        headers,
        body: isFormData
          ? (options.body as any)
          : options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      if (__DEV__) {
        console.warn('[api] request failed', method, `${API_BASE_URL}${path}`, error);
      }
      throw new ApiError(
        0,
        aborted ? 'request_timeout' : 'network_error',
        aborted
          ? `The API did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds.`
          : `Cannot reach the API at ${API_BASE_URL}. Check that the backend is running and the API address is reachable.${networkHint}`,
      );
    }

    if (
      response.status === 401 &&
      auth &&
      this.refreshToken &&
      !options.retried &&
      !path.startsWith('/auth/refresh')
    ) {
      try {
        await this.refresh();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          this.onAuthFailure?.();
          throw new ApiError(
            401,
            'session_expired',
            'Your session has expired. Sign in again.',
          );
        }
        throw error;
      }
      return this.request<T>(path, { ...options, retried: true });
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const envelope = (payload ?? {}) as ErrorEnvelope;
      throw new ApiError(
        response.status,
        envelope.error?.code ?? 'request_failed',
        envelope.error?.message ?? 'The request could not be completed.',
        envelope.error?.field_errors ?? {},
        envelope.error?.retryable ?? false,
      );
    }

    return payload as T;
  }

  async requestText(path: string, options: RequestOptions = {}): Promise<string> {
    const method = options.method ?? 'GET';
    const auth = options.auth ?? true;
    const headers: Record<string, string> = {
      ...options.headers,
    };
    if (auth && this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    const response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
      method,
      headers,
    });
    if (!response.ok) {
      throw new ApiError(response.status, 'request_failed', 'Request failed');
    }
    return response.text();
  }

  async refresh(): Promise<TokenPair> {
    if (!this.refreshToken) {
      throw new ApiError(401, 'session_expired', 'Your session has expired.');
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.performRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async performRefresh(): Promise<TokenPair> {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      if (__DEV__) {
        console.warn('[api] token refresh failed', API_BASE_URL, error);
      }
      throw new ApiError(
        0,
        aborted ? 'request_timeout' : 'network_error',
        aborted
          ? `The API did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds.`
          : `Cannot reach the API at ${API_BASE_URL}.${networkHint}`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(401, 'session_expired', 'Your session has expired.');
    }
    if (!response.ok) {
      throw new ApiError(
        response.status,
        'server_error',
        'The server could not refresh your session. Try again.',
        {},
        true,
      );
    }
    const tokens = (await response.json()) as TokenPair;
    this.setTokens(tokens.access_token, tokens.refresh_token);
    this.onTokens?.(tokens);
    return tokens;
  }

  login(email: string, password: string, companyId?: string) {
    return this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      auth: false,
      body: { email, password, company_id: companyId },
    });
  }

  registerCompany(input: {
    company_name: string;
    name: string;
    email: string;
    password: string;
    phone?: string;
    warehouse_name?: string;
    warehouse_code?: string;
    warehouse_address?: string;
    warehouse_type?: string;
    warehouse_layout?: string;
    warehouse_category?: string;
    location_code?: string;
  }) {
    return this.request<AuthResponse>('/auth/register-company', {
      method: 'POST',
      auth: false,
      body: { ...input, currency: 'USD', timezone: 'UTC' },
    });
  }

  checkUser(email: string) {
    return this.request<{
      exists: boolean;
      is_active: boolean;
      email: string;
    }>('/auth/check-user', {
      method: 'POST',
      auth: false,
      body: { email },
    });
  }

  forgotPassword(email: string) {
    return this.request<{
      message: string;
      expires_in_minutes: number;
      email_sent?: boolean;
      dev_code?: string;
    }>('/auth/forgot-password', {
      method: 'POST',
      auth: false,
      body: { email },
    });
  }

  resetPassword(input: { email: string; code: string; new_password: string }) {
    return this.request<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      auth: false,
      body: input,
    });
  }

  changePassword(input: { current_password: string; new_password: string }) {
    return this.request<{ message: string }>('/auth/change-password', {
      method: 'POST',
      auth: true,
      body: input,
    });
  }

  updateProfile(input: { name?: string; phone?: string | null }) {
    return this.request<User>('/auth/me', {
      method: 'PATCH',
      auth: true,
      body: input,
    });
  }

  devPendingInvitations() {
    return this.request<
      Array<{
        id: string;
        company_name: string;
        email: string;
        role: string;
        role_label: string;
        invite_code?: string;
        token_preview: string;
        expires_at: string;
      }>
    >('/auth/dev-pending-invitations', {
      method: 'GET',
      auth: false,
    });
  }

  logout(refreshToken: string) {
    return this.request<void>('/auth/logout', {
      method: 'POST',
      auth: false,
      body: { refresh_token: refreshToken },
    });
  }

  previewInvitation(invitationToken: string) {
    return this.request<InvitationPreview>('/auth/invitation-preview', {
      method: 'POST',
      auth: false,
      body: { invitation_token: invitationToken },
    });
  }

  acceptInvitation(input: AcceptInvitationInput) {
    return this.request<AuthResponse>('/auth/accept-invitation', {
      method: 'POST',
      auth: false,
      body: input,
    });
  }

  session() {
    return this.request<Session>('/auth/session');
  }

  teamOverview() {
    return this.request<TeamOverview>('/members/overview');
  }

  members(options: {
    search?: string;
    status?: string;
    role?: string;
    warehouse_id?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const params = [
      options.search ? `search=${encodeURIComponent(options.search)}` : '',
      options.status ? `status=${encodeURIComponent(options.status)}` : '',
      options.role ? `role=${encodeURIComponent(options.role)}` : '',
      options.warehouse_id ? `warehouse_id=${encodeURIComponent(options.warehouse_id)}` : '',
      options.limit ? `limit=${options.limit}` : '',
      options.offset ? `offset=${options.offset}` : '',
    ].filter(Boolean);
    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    return this.request<MemberListResponse>(`/members${qs}`);
  }

  member(membershipId: string) {
    return this.request<Member>(`/members/${encodeURIComponent(membershipId)}`);
  }

  updateMember(
    membershipId: string,
    input: {
      role?: string;
      status?: string;
      location_ids?: string[];
      warehouse_ids?: string[];
      client_ids?: string[];
      valid_from?: string | null;
      valid_until?: string | null;
      department?: string | null;
      job_title?: string | null;
      employee_id?: string | null;
    },
  ) {
    return this.request<Member>(`/members/${encodeURIComponent(membershipId)}`, {
      method: 'PATCH',
      body: input,
    });
  }

  suspendMember(membershipId: string, reason?: string) {
    return this.request<Member>(`/members/${encodeURIComponent(membershipId)}/suspend`, {
      method: 'POST',
      body: { reason: reason || undefined },
    });
  }

  reactivateMember(membershipId: string) {
    return this.request<Member>(`/members/${encodeURIComponent(membershipId)}/reactivate`, {
      method: 'POST',
    });
  }

  removeMember(membershipId: string) {
    return this.request<void>(`/members/${encodeURIComponent(membershipId)}`, {
      method: 'DELETE',
    });
  }

  roles() {
    return this.request<RoleDefinition[]>('/members/roles');
  }

  createCustomRole(input: CustomRoleInput) {
    return this.request<RoleDefinition>('/members/roles', {
      method: 'POST',
      body: input,
    });
  }

  updateCustomRole(roleId: string, input: Partial<CustomRoleInput>) {
    return this.request<RoleDefinition>(`/members/roles/${encodeURIComponent(roleId)}`, {
      method: 'PATCH',
      body: input,
    });
  }

  deleteCustomRole(roleId: string) {
    return this.request<void>(`/members/roles/${encodeURIComponent(roleId)}`, {
      method: 'DELETE',
    });
  }

  permissionsCatalogue() {
    return this.request<PermissionCategory[]>('/members/permissions');
  }

  invitations(status?: string) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request<{ invitations: Invitation[] }>(`/members/invitations${qs}`);
  }

  createInvitation(input: {
    email: string;
    role: string;
    name?: string;
    phone?: string;
    warehouse_ids?: string[];
    location_ids?: string[];
    client_ids?: string[];
    valid_from?: string;
    valid_until?: string;
    department?: string;
    job_title?: string;
    employee_id?: string;
  }) {
    return this.request<CreatedInvitation>('/members/invitations', {
      method: 'POST',
      body: input,
    });
  }

  createBulkInvitations(input: {
    emails: string[];
    role: string;
    warehouse_ids?: string[];
    location_ids?: string[];
    client_ids?: string[];
  }) {
    return this.request<BulkInvitationResponse>('/members/invitations/bulk', {
      method: 'POST',
      body: input,
    });
  }

  resendInvitation(invitationId: string) {
    return this.request<CreatedInvitation>(`/members/invitations/${encodeURIComponent(invitationId)}/resend`, {
      method: 'POST',
    });
  }

  replaceInvitation(invitationId: string) {
    return this.request<CreatedInvitation>(`/members/invitations/${encodeURIComponent(invitationId)}/replace`, {
      method: 'POST',
    });
  }

  revokeInvitation(invitationId: string) {
    return this.request<void>(`/members/invitations/${encodeURIComponent(invitationId)}`, {
      method: 'DELETE',
    });
  }

  previewExcelImport(fileFormData: FormData) {
    return this.request<ExcelImportPreviewResponse>('/members/import/preview', {
      method: 'POST',
      body: fileFormData,
    });
  }

  confirmExcelImport(input: ExcelImportConfirmRequest) {
    return this.request<ExcelImportConfirmResponse>('/members/import/confirm', {
      method: 'POST',
      body: input,
    });
  }

  getImportTemplateUrl() {
    return `${API_BASE_URL}/members/import/template`;
  }

  async downloadImportTemplateBlob(): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    const res = await fetchWithTimeout(`${API_BASE_URL}/members/import/template`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) {
      throw new ApiError(res.status, 'template_download_failed', 'Could not download Excel template.');
    }
    return await res.blob();
  }

  items(clientId?: string | null, supplierId?: string | null) {
    const supplierQuery = supplierId
      ? `&supplier_id=${encodeURIComponent(supplierId)}`
      : '';
    return this.request<ItemList>(
      `/items?limit=1000${clientQuery(clientId)}${supplierQuery}`,
    );
  }

  createItem(input: {
    client_id?: string;
    sku: string;
    name: string;
    barcode?: string;
    base_uom: string;
    tracking_mode?: 'none' | 'lot' | 'serial';
    expiry_tracked?: boolean;
    reorder_point?: string;
  }) {
    return this.request<Item>('/items', { method: 'POST', body: input });
  }

  bulkImportItems(input: BulkImportInput) {
    return this.request<BulkImportResponse>('/items/bulk-import', {
      method: 'POST',
      body: input,
    });
  }

  getItemTemplate() {
    return this.requestText('/items/csv-template');
  }

  exportItemsCsv(clientId?: string | null) {
    return this.requestText(`/items/export?format=csv${clientQuery(clientId)}`);
  }

  async exportItemsExcelBlob(clientId?: string | null): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    const res = await fetchWithTimeout(
      `${API_BASE_URL}/items/export?format=xlsx${clientQuery(clientId)}`,
      { method: 'GET', headers },
    );
    if (!res.ok) {
      throw new ApiError(res.status, 'export_failed', 'Could not export Excel file.');
    }
    return await res.blob();
  }

  getItem(itemId: string) {
    return this.request<Item>(`/items/${encodeURIComponent(itemId)}`);
  }

  updateItem(itemId: string, input: ItemUpdateInput) {
    return this.request<Item>(`/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: input,
    });
  }

  itemSuppliers(itemId: string, includeInactive = true) {
    return this.request<ItemSupplierList>(
      `/items/${encodeURIComponent(itemId)}/suppliers?include_inactive=${includeInactive}`,
    );
  }

  linkItemSupplier(itemId: string, input: ItemSupplierInput) {
    return this.request<ItemSupplier>(
      `/items/${encodeURIComponent(itemId)}/suppliers`,
      { method: 'POST', body: input },
    );
  }

  updateItemSupplier(
    itemId: string,
    mappingId: string,
    input: ItemSupplierUpdateInput,
  ) {
    return this.request<ItemSupplier>(
      `/items/${encodeURIComponent(itemId)}/suppliers/${encodeURIComponent(mappingId)}`,
      { method: 'PATCH', body: input },
    );
  }

  unlinkItemSupplier(itemId: string, mappingId: string) {
    return this.request<void>(
      `/items/${encodeURIComponent(itemId)}/suppliers/${encodeURIComponent(mappingId)}`,
      { method: 'DELETE' },
    );
  }

  supplierItems(supplierId: string, includeInactive = true) {
    return this.request<SupplierItemList>(
      `/clients/${encodeURIComponent(supplierId)}/items?include_inactive=${includeInactive}`,
    );
  }

  lots(itemId: string, clientId?: string | null) {
    return this.request<LotList>(
      `/lots?item_id=${encodeURIComponent(itemId)}&limit=200${clientQuery(clientId)}`,
    );
  }

  serials(itemId: string, clientId?: string | null) {
    return this.request<SerialList>(
      `/serials?item_id=${encodeURIComponent(itemId)}&limit=200${clientQuery(clientId)}`,
    );
  }

  itemMovements(itemId: string, clientId?: string | null) {
    return this.request<MovementList>(
      `/movements?item_id=${encodeURIComponent(itemId)}&limit=100${clientQuery(clientId)}`,
    );
  }

  clients(options?: { type?: string; search?: string; includeArchived?: boolean } | boolean) {
    if (typeof options === 'boolean') {
      const archived = options ? '?include_archived=true' : '';
      return this.request<{ clients: Client[] }>(`/clients${archived}`);
    }
    const params = new URLSearchParams();
    if (options?.includeArchived) params.set('include_archived', 'true');
    if (options?.type) params.set('type', options.type);
    if (options?.search) params.set('search', options.search);
    const qs = params.toString();
    return this.request<{ clients: Client[] }>(`/clients${qs ? `?${qs}` : ''}`);
  }

  client(clientId: string) {
    return this.request<Client>(`/clients/${encodeURIComponent(clientId)}`);
  }

  createClient(input: {
    code: string;
    name: string;
    display_name?: string;
    types?: PartnerRole[];
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    contacts?: PartnerContact[];
    tax_id?: string;
    billing_address?: PartnerAddress | null;
    addresses?: PartnerAddress[];
    notes?: string;
  }) {
    return this.request<Client>('/clients', { method: 'POST', body: input });
  }

  updateClient(
    clientId: string,
    input: {
      name?: string;
      display_name?: string;
      types?: PartnerRole[];
      contact_name?: string;
      contact_email?: string;
      contact_phone?: string;
      contacts?: PartnerContact[];
      tax_id?: string;
      billing_address?: PartnerAddress | null;
      addresses?: PartnerAddress[];
      notes?: string;
      status?: 'active' | 'archived';
    },
  ) {
    return this.request<Client>(`/clients/${encodeURIComponent(clientId)}`, {
      method: 'PATCH',
      body: input,
    });
  }

  previewPartnerImport(fileFormData: FormData) {
    return this.request<PartnerImportPreviewResponse>('/clients/import/preview', {
      method: 'POST',
      body: fileFormData,
    });
  }

  confirmPartnerImport(input: PartnerImportConfirmRequest) {
    return this.request<PartnerImportConfirmResponse>('/clients/import/confirm', {
      method: 'POST',
      body: input,
    });
  }

  async downloadPartnerTemplateBlob(): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    const res = await fetchWithTimeout(`${API_BASE_URL}/clients/import/template`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) {
      throw new ApiError(res.status, 'template_download_failed', 'Could not download Partner Excel template.');
    }
    return await res.blob();
  }

  async exportPartnersBlob(): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    const res = await fetchWithTimeout(`${API_BASE_URL}/clients/export`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) {
      throw new ApiError(res.status, 'export_failed', 'Could not export Partners to Excel.');
    }
    return await res.blob();
  }

  updateCompany(input: {
    name?: string;
    inventory_model?: string;
    currency?: string;
    timezone?: string;
    allow_over_receipt?: boolean;
  }) {
    return this.request<Session['company']>('/company', {
      method: 'PATCH',
      body: input,
    });
  }

  warehouses() {
    return this.request<{ warehouses: Warehouse[] }>('/warehouses');
  }

  createWarehouse(input: {
    name: string;
    code?: string;
    address?: string | null;
    warehouse_type?: string;
    warehouse_layout?: string;
    apply_default_locations?: boolean;
    selected_zones?: string[];
    initial_locations?: InitialLocationCreate[];
  }) {
    return this.request<Warehouse>('/warehouses', {
      method: 'POST',
      body: input,
    });
  }

  updateWarehouse(
    warehouseId: string,
    input: {
      name?: string;
      code?: string | null;
      address?: string | null;
      warehouse_type?: string;
      warehouse_layout?: string;
      status?: string;
    },
  ) {
    return this.request<Warehouse>(`/warehouses/${encodeURIComponent(warehouseId)}`, {
      method: 'PATCH',
      body: input,
    });
  }

  applyWarehouseTemplate(
    warehouseId: string,
    previewOnly = false,
    selectedZones?: string[],
    initialLocations?: InitialLocationCreate[],
  ) {
    return this.request<WarehouseTemplateApplyResponse>(
      `/warehouses/${encodeURIComponent(warehouseId)}/apply-template`,
      {
        method: 'POST',
        body: {
          preview_only: previewOnly,
          selected_zones: selectedZones,
          initial_locations: initialLocations,
        },
      },
    );
  }

  locations(warehouseId?: string, status?: string) {
    const params = [
      warehouseId ? `warehouse_id=${encodeURIComponent(warehouseId)}` : '',
      status ? `status=${encodeURIComponent(status)}` : '',
    ].filter(Boolean);
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    return this.request<{ locations: Location[] }>(`/locations${query}`);
  }

  createLocation(input: {
    warehouse_id: string;
    parent_id?: string;
    code: string;
    type: string;
    is_pickable?: boolean;
    status?: 'active' | 'blocked' | 'archived';
    barcode?: string | null;
    zone?: string | null;
    aisle?: string | null;
    rack?: string | null;
    shelf?: string | null;
    bin?: string | null;
  }) {
    return this.request<Location>('/locations', {
      method: 'POST',
      body: input,
    });
  }

  updateLocation(
    locationId: string,
    input: {
      code?: string;
      barcode?: string | null;
      type?: string;
      is_pickable?: boolean;
      status?: 'active' | 'blocked' | 'archived';
      zone?: string | null;
      aisle?: string | null;
      rack?: string | null;
      shelf?: string | null;
      bin?: string | null;
    },
  ) {
    return this.request<Location>(`/locations/${encodeURIComponent(locationId)}`, {
      method: 'PATCH',
      body: input,
    });
  }

  generateBulkLocations(input: BulkLocationGenerateRequest) {
    return this.request<BulkLocationGenerateResponse>('/locations/bulk', {
      method: 'POST',
      body: input,
    });
  }

  balances(clientId?: string | null) {
    return this.request<BalanceList>(`/balances?limit=200${clientQuery(clientId)}`);
  }

  locationBalances(locationId: string, clientId?: string | null) {
    const cq = clientQuery(clientId);
    const prefix = cq ? `${cq}&` : '?';
    return this.request<BalanceList>(
      `/balances${prefix}location_id=${encodeURIComponent(locationId)}&limit=200`,
    );
  }

  movements(clientId?: string | null) {
    return this.request<MovementList>(`/movements?limit=40${clientQuery(clientId)}`);
  }

  reorderNeeded(
    options: {
      search?: string;
      warehouseId?: string | null;
      clientId?: string | null;
      supplierId?: string | null;
      status?: string;
    } = {},
  ) {
    const params = ['limit=500'];
    if (options.search?.trim()) {
      params.push(`search=${encodeURIComponent(options.search.trim())}`);
    }
    if (options.warehouseId) {
      params.push(`warehouse_id=${encodeURIComponent(options.warehouseId)}`);
    }
    if (options.supplierId) {
      params.push(`supplier_id=${encodeURIComponent(options.supplierId)}`);
    }
    if (options.status && options.status !== 'all') {
      params.push(`status=${encodeURIComponent(options.status)}`);
    }
    return this.request<ReorderNeededResponse>(
      `/reorder-needed?${params.join('&')}${clientQuery(options.clientId)}`,
    );
  }

  dashboard() {
    return this.request<DashboardSummary>('/dashboard');
  }

  purchaseOrders(
    options: {
      status?: string;
      supplierId?: string;
      warehouseId?: string;
      clientId?: string | null;
      search?: string;
      limit?: number;
    } = {},
  ) {
    const params = [
      options.status && options.status !== 'all'
        ? `status=${encodeURIComponent(options.status)}`
        : '',
      options.supplierId ? `supplier_id=${encodeURIComponent(options.supplierId)}` : '',
      options.warehouseId ? `warehouse_id=${encodeURIComponent(options.warehouseId)}` : '',
      options.search?.trim() ? `search=${encodeURIComponent(options.search.trim())}` : '',
      `limit=${options.limit ?? 50}${clientQuery(options.clientId)}`,
    ].filter(Boolean);
    return this.request<PurchaseOrderList>(`/purchase-orders?${params.join('&')}`);
  }

  purchaseOrder(purchaseOrderId: string) {
    return this.request<PurchaseOrder>(
      `/purchase-orders/${encodeURIComponent(purchaseOrderId)}`,
    );
  }

  createPurchaseOrder(input: CreatePurchaseOrderInput, idempotencyKey: string) {
    return this.request<PurchaseOrder>('/purchase-orders', {
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  cancelPurchaseOrder(purchaseOrderId: string) {
    return this.request<PurchaseOrder>(
      `/purchase-orders/${encodeURIComponent(purchaseOrderId)}/cancel`,
      { method: 'POST' },
    );
  }

  receipts(status?: string, clientId?: string | null) {
    const query = status
      ? `?status=${encodeURIComponent(status)}&limit=25${clientQuery(clientId)}`
      : `?limit=25${clientQuery(clientId)}`;
    return this.request<ReceiptList>(`/receipts${query}`);
  }

  receiptHistory(
    options: {
      status?: string;
      supplierId?: string | null;
      itemId?: string | null;
      purchaseOrderId?: string | null;
      warehouseId?: string | null;
      clientId?: string | null;
      dateFrom?: string | null;
      dateTo?: string | null;
      search?: string;
      limit?: number;
      cursor?: string | null;
    } = {},
  ) {
    const params = [
      options.status && options.status !== 'all'
        ? `status=${encodeURIComponent(options.status)}`
        : '',
      options.supplierId
        ? `supplier_id=${encodeURIComponent(options.supplierId)}`
        : '',
      options.itemId ? `item_id=${encodeURIComponent(options.itemId)}` : '',
      options.purchaseOrderId
        ? `purchase_order_id=${encodeURIComponent(options.purchaseOrderId)}`
        : '',
      options.warehouseId
        ? `warehouse_id=${encodeURIComponent(options.warehouseId)}`
        : '',
      options.dateFrom ? `date_from=${encodeURIComponent(options.dateFrom)}` : '',
      options.dateTo ? `date_to=${encodeURIComponent(options.dateTo)}` : '',
      options.search?.trim() ? `search=${encodeURIComponent(options.search.trim())}` : '',
      options.cursor ? `cursor=${encodeURIComponent(options.cursor)}` : '',
      `limit=${options.limit ?? 50}${clientQuery(options.clientId)}`,
    ].filter(Boolean);
    return this.request<ReceiptList>(`/receipts?${params.join('&')}`);
  }

  exportReceiptsCsv(
    options: {
      status?: string;
      supplierId?: string | null;
      itemId?: string | null;
      purchaseOrderId?: string | null;
      warehouseId?: string | null;
      clientId?: string | null;
      dateFrom?: string | null;
      dateTo?: string | null;
      search?: string;
    } = {},
  ) {
    const params = [
      options.status && options.status !== 'all'
        ? `status=${encodeURIComponent(options.status)}`
        : '',
      options.supplierId
        ? `supplier_id=${encodeURIComponent(options.supplierId)}`
        : '',
      options.itemId ? `item_id=${encodeURIComponent(options.itemId)}` : '',
      options.purchaseOrderId
        ? `purchase_order_id=${encodeURIComponent(options.purchaseOrderId)}`
        : '',
      options.warehouseId
        ? `warehouse_id=${encodeURIComponent(options.warehouseId)}`
        : '',
      options.dateFrom ? `date_from=${encodeURIComponent(options.dateFrom)}` : '',
      options.dateTo ? `date_to=${encodeURIComponent(options.dateTo)}` : '',
      options.search?.trim() ? `search=${encodeURIComponent(options.search.trim())}` : '',
      `format=csv${clientQuery(options.clientId)}`,
    ].filter(Boolean);
    return this.requestText(`/receipts/export?${params.join('&')}`);
  }

  createReceipt(input: CreateReceiptInput, idempotencyKey: string) {
    return this.request<Receipt>('/receipts', {
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  getReceipt(receiptId: string) {
    return this.request<Receipt>(`/receipts/${receiptId}`);
  }

  commitReceipt(receiptId: string) {
    return this.request<Receipt>(`/receipts/${receiptId}/commit`, {
      method: 'POST',
    });
  }

  cancelReceipt(receiptId: string) {
    return this.request<Receipt>(`/receipts/${encodeURIComponent(receiptId)}/cancel`, {
      method: 'POST',
    });
  }

  putawayTasks(options: {
    status?: string;
    receiptId?: string;
    clientId?: string | null;
    warehouseId?: string | null;
    fromLocationId?: string | null;
    search?: string;
    limit?: number;
    cursor?: string | null;
  } = {}) {
    const validClient =
      options.clientId && options.clientId !== 'all' && options.clientId !== '*'
        ? options.clientId
        : null;
    const params = [
      options.status ? `status=${encodeURIComponent(options.status)}` : '',
      options.receiptId ? `receipt_id=${encodeURIComponent(options.receiptId)}` : '',
      validClient ? `client_id=${encodeURIComponent(validClient)}` : '',
      options.warehouseId
        ? `warehouse_id=${encodeURIComponent(options.warehouseId)}`
        : '',
      options.fromLocationId
        ? `from_location_id=${encodeURIComponent(options.fromLocationId)}`
        : '',
      options.search?.trim()
        ? `search=${encodeURIComponent(options.search.trim())}`
        : '',
      options.cursor ? `cursor=${encodeURIComponent(options.cursor)}` : '',
      `limit=${options.limit ?? 200}`,
    ].filter(Boolean);
    return this.request<PutawayTaskList>(`/putaway/tasks?${params.join('&')}`);
  }

  completePutaway(
    taskId: string,
    locationId: string,
    options: {
      quantity?: string;
      serialIds?: string[];
      idempotencyKey?: string;
    } = {},
  ) {
    return this.request<PutawayTask>(`/putaway/tasks/${taskId}/complete`, {
      method: 'POST',
      headers: options.idempotencyKey
        ? { 'Idempotency-Key': options.idempotencyKey }
        : undefined,
      body: {
        location_id: locationId,
        ...(options.quantity ? { quantity: options.quantity } : {}),
        ...(options.serialIds?.length ? { serial_ids: options.serialIds } : {}),
      },
    });
  }


  outboundOrders(options: { status?: string; clientId?: string | null } = {}) {
    const params = [
      options.status ? `status=${encodeURIComponent(options.status)}` : '',
      `limit=50${clientQuery(options.clientId)}`,
    ].filter(Boolean);
    return this.request<OutboundOrderList>(`/outbound/orders?${params.join('&')}`);
  }

  createOutboundOrder(input: CreateOutboundOrderInput, idempotencyKey: string) {
    return this.request<OutboundOrder>('/outbound/orders', {
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  allocateOutboundOrder(orderId: string) {
    return this.request<OutboundOrder>(
      `/outbound/orders/${encodeURIComponent(orderId)}/allocate`,
      { method: 'POST' },
    );
  }

  pickOutboundAllocation(orderId: string, allocationId: string) {
    return this.request<OutboundOrder>(
      `/outbound/orders/${encodeURIComponent(orderId)}/allocations/${encodeURIComponent(
        allocationId,
      )}/pick`,
      { method: 'POST' },
    );
  }

  shipOutboundOrder(orderId: string) {
    return this.request<OutboundOrder>(
      `/outbound/orders/${encodeURIComponent(orderId)}/ship`,
      { method: 'POST' },
    );
  }

  cancelOutboundOrder(orderId: string) {
    return this.request<OutboundOrder>(
      `/outbound/orders/${encodeURIComponent(orderId)}/cancel`,
      { method: 'POST' },
    );
  }

  transfers(options: {
    status?: string;
    clientId?: string | null;
    fromWarehouseId?: string;
    toWarehouseId?: string;
  } = {}) {
    const validClient =
      options.clientId && options.clientId !== 'all' && options.clientId !== '*'
        ? options.clientId
        : null;
    const params = [
      options.status ? `status=${encodeURIComponent(options.status)}` : '',
      validClient ? `client_id=${encodeURIComponent(validClient)}` : '',
      options.fromWarehouseId
        ? `from_warehouse_id=${encodeURIComponent(options.fromWarehouseId)}`
        : '',
      options.toWarehouseId
        ? `to_warehouse_id=${encodeURIComponent(options.toWarehouseId)}`
        : '',
      'limit=50',
    ].filter(Boolean);
    return this.request<TransferListResponse>(`/transfers?${params.join('&')}`);
  }

  transfer(transferId: string) {
    return this.request<Transfer>(`/transfers/${encodeURIComponent(transferId)}`);
  }

  createTransfer(input: CreateTransferInput, idempotencyKey: string) {
    return this.request<Transfer>('/transfers', {
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  confirmTransfer(transferId: string) {
    return this.request<Transfer>(
      `/transfers/${encodeURIComponent(transferId)}/confirm`,
      { method: 'POST' },
    );
  }

  receiveTransfer(transferId: string) {
    return this.request<Transfer>(
      `/transfers/${encodeURIComponent(transferId)}/receive`,
      { method: 'POST' },
    );
  }

  cancelTransfer(transferId: string) {
    return this.request<Transfer>(
      `/transfers/${encodeURIComponent(transferId)}/cancel`,
      { method: 'POST' },
    );
  }

  scanResolve(code: string, clientId?: string | null) {
    return this.request<ScanResolveResult>('/scan/resolve', {
      method: 'POST',
      body: { code, client_id: clientId ?? undefined },
    });
  }

  getInspectionTemplates() {
    return this.request<InspectionTemplatesResponse>('/inspections/templates');
  }

  getInspectionQueue(options?: {
    warehouse_id?: string;
    supplier_id?: string;
    status_filter?: string;
  }) {
    const params = [
      options?.warehouse_id ? `warehouse_id=${encodeURIComponent(options.warehouse_id)}` : '',
      options?.supplier_id ? `supplier_id=${encodeURIComponent(options.supplier_id)}` : '',
      options?.status_filter ? `status_filter=${encodeURIComponent(options.status_filter)}` : '',
    ].filter(Boolean);
    return this.request<InspectionQueueItem[]>(`/inspections/queue${params.length ? `?${params.join('&')}` : ''}`);
  }

  submitInspection(input: InspectionSubmitInput) {
    return this.request<InspectionRecord>('/inspections', {
      method: 'POST',
      body: input,
    });
  }

  getInspectionHistory(options?: {
    warehouse_id?: string;
    item_id?: string;
  }) {
    const params = [
      options?.warehouse_id ? `warehouse_id=${encodeURIComponent(options.warehouse_id)}` : '',
      options?.item_id ? `item_id=${encodeURIComponent(options.item_id)}` : '',
    ].filter(Boolean);
    return this.request<InspectionRecord[]>(`/inspections/history${params.length ? `?${params.join('&')}` : ''}`);
  }

  syncPush(operations: SyncOperation[], deviceId?: string) {
    return this.request<SyncPushResponse>('/sync/push', {
      method: 'POST',
      body: { device_id: deviceId, operations },
    });
  }

  syncPull(after = 0, limit = 100) {
    return this.request<SyncPullResponse>(
      `/sync/pull?after=${after}&limit=${limit}`,
    );
  }
}

export const api = new ApiClient();
