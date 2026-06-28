import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { showToast } from './toast';
import { supabase } from './supabase';
import { useDebugStore } from '../store/debugStore';

// Backend base URL is injected at build time via Vite. Set VITE_API_URL to the
// deployed backend origin (e.g. https://trademirror-1.onrender.com). The "/api"
// prefix is appended here so the env var holds only the origin. Falls back to the
// local dev server when unset.
const API_ORIGIN = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:4000';
const API_BASE_URL = `${API_ORIGIN}/api`;

const REQUEST_TIMEOUT_MS = 60000;

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

type TimedConfig = InternalAxiosRequestConfig & { metadata?: { start: number } };

api.interceptors.request.use(
  async (config: TimedConfig) => {
    config.metadata = { start: Date.now() };
    const method = (config.method || 'get').toUpperCase();
    const url = `${config.baseURL ?? ''}${config.url ?? ''}`;
    
    // Attach JWT if available
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`;
    }

    // Debug logging
    useDebugStore.getState().addLog({
      type: 'request',
      method,
      url: config.url,
      payload: config.data instanceof FormData ? '[FormData upload]' : config.data
    });

    const idMatch = (config.url ?? '').match(/\/trades\/([^/]+)/);
    console.groupCollapsed(`%c➡️ ${method} ${config.url}`, 'color:#2563eb;font-weight:bold');
    console.log('Endpoint:', url);
    console.log('Method:', method);
    console.log('Trade ID:', idMatch ? idMatch[1] : '(none)');
    console.log('Payload:', config.data instanceof FormData ? '[FormData upload]' : config.data ?? '(none)');
    console.groupEnd();
    
    return config;
  },
  (error) => {
    console.error('❌ Axios request setup failed:', error);
    showToast('Failed to send request. Check your connection.');
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => {
    const cfg = response.config as TimedConfig;
    const ms = cfg.metadata ? Date.now() - cfg.metadata.start : -1;
    const method = (cfg.method || 'get').toUpperCase();
    
    // Extract debug envelope from new backend format
    const envelope = response.data;
    const isEnvelope = envelope && typeof envelope === 'object' && 'success' in envelope;
    
    useDebugStore.getState().addLog({
      type: 'response',
      method,
      url: cfg.url,
      payload: isEnvelope ? envelope.data : envelope,
      debug: isEnvelope ? envelope.debug : undefined
    });

    console.groupCollapsed(
      `%c✅ ${response.status} ${method} ${cfg.url} (${ms}ms)`,
      'color:#16a34a;font-weight:bold'
    );
    console.log('Status:', response.status);
    console.log('Time taken:', `${ms}ms`);
    console.log('Response body:', envelope);
    console.groupEnd();
    
    // Unwrap the envelope so components don't have to change
    if (isEnvelope) {
      response.data = envelope.data;
    }
    
    return response;
  },
  (error: AxiosError) => {
    const cfg = (error.config || {}) as TimedConfig;
    const ms = cfg.metadata ? Date.now() - cfg.metadata.start : -1;
    const method = (cfg.method || 'get').toUpperCase();

    const body = (error.response?.data as any);
    const isEnvelope = body && typeof body === 'object' && 'debug' in body;

    useDebugStore.getState().addLog({
      type: 'error',
      method,
      url: cfg.url,
      payload: isEnvelope ? body.data : undefined,
      debug: isEnvelope ? body.debug : { error: error.message }
    });

    console.groupCollapsed(
      `%c❌ FAILED ${method} ${cfg.url} (${ms}ms)`,
      'color:#dc2626;font-weight:bold'
    );
    console.error('Message:', error.message);
    console.error('Code:', error.code ?? '(none)');

    let toastMsg: string;
    if (error.response) {
      console.error('-- error.response (server replied) --');
      console.error('Status:', error.response.status);
      console.error('Body:', error.response.data);
      
      const debugError = isEnvelope ? body.debug?.error : undefined;
      const displayErr = debugError || body?.error || JSON.stringify(error.response.data);
      
      toastMsg = `${method} ${cfg.url} → ${error.response.status}\n${displayErr}`;
    } else if (error.request) {
      console.error('-- error.request (no response received) --');
      toastMsg = error.code === 'ECONNABORTED'
        ? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${method} ${cfg.url}`
        : `No response from server: ${method} ${cfg.url}. Is the backend running?`;
    } else {
      toastMsg = `Request error: ${error.message}`;
    }
    console.groupEnd();

    showToast(toastMsg, 'error');
    return Promise.reject(error);
  }
);

export interface Trade {
  id: string;
  original_pdf_url: string | null;
  extracted_data?: any;
  edited_data?: any;
  generated_pdf_url: string | null;
  status: 'draft' | 'active' | 'completed';
  created_at: string;
  updated_at?: string;
  trade_reference?: string | null;
  client_id?: string | null;
  bank_profile_id?: string | null;
  currency?: string | null;
  signing_date?: string | null;
  // Financial columns. total_costs + net_profit are computed server-side.
  frigo_purchase_price?: number | null;
  sale_unit_price?: number | null;
  sale_total?: number | null;
  shipping_cost?: number | null;
  insurance_cost?: number | null;
  bank_fees?: number | null;
  total_costs?: number | null;
  net_profit?: number | null;
}

/** Financial INPUT fields a user may edit (totals are derived server-side). */
export interface TradeFinancialInput {
  trade_reference?: string | null;
  currency?: string | null;
  signing_date?: string | null;
  frigo_purchase_price?: number | null;
  sale_unit_price?: number | null;
  sale_total?: number | null;
  shipping_cost?: number | null;
  insurance_cost?: number | null;
  bank_fees?: number | null;
}

export interface TradeGeneration {
  id: string;
  trade_id: string;
  version: number;
  generated_pdf_url: string;
  storage_path: string | null;
  created_at: string;
  snapshot?: Record<string, any> | null;
  created_by?: string | null;
}

export type TradeDocumentType = 'signed_contract' | 'bol' | 'additional';

export interface TradeDocument {
  id: string;
  trade_id: string;
  doc_type: TradeDocumentType;
  file_name: string;
  storage_path: string;
  file_url: string;
  mime_type: string | null;
  size_bytes: number | null;
  bol_date: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export const tradesApi = {
  getTrades: async (): Promise<Trade[]> => {
    const { data } = await api.get('/trades');
    return data;
  },
  getTrade: async (id: string): Promise<Trade> => {
    const { data } = await api.get(`/trades/${id}`);
    return data;
  },
  createTrade: async (file: File): Promise<Trade> => {
    const formData = new FormData();
    formData.append('pdf', file);
    const { data } = await api.post('/trades/create', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },
  updateTrade: async (
    id: string,
    payload: { edited_data?: any; status?: Trade['status']; bank_profile_id?: string | null } & TradeFinancialInput
  ): Promise<Trade> => {
    const { data } = await api.put(`/trades/${id}`, payload);
    return data;
  },
  generatePdf: async (id: string): Promise<Trade> => {
    const { data } = await api.post(`/trades/${id}/generate-pdf`, {});
    return data;
  },
  deleteTrade: async (id: string): Promise<{ success: boolean; id: string }> => {
    const { data } = await api.delete(`/trades/${id}`);
    return data;
  },
  getTradeGenerations: async (id: string): Promise<TradeGeneration[]> => {
    const { data } = await api.get(`/trades/${id}/generations`);
    return data;
  },
};

export interface Client {
  id: string;
  name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  contact_person: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientAnalytics {
  totalTrades: number;
  totalRevenue: number;
  totalCosts: number;
  netProfit: number;
  averageProfitPerTrade: number;
  lastTradeDate: string | null;
}

export interface ClientFinancialSummary {
  totalTrades: number;
  totalRevenue: number;
  totalFrigo: number;
  totalShipping: number;
  totalInsurance: number;
  totalBankFees: number;
  totalCosts: number;
  totalNetProfit: number;
  averageNetProfit: number;
  lastTradeDate: string | null;
}

export interface ProfitAnalysisPoint {
  month: string;
  tradeCount: number;
  revenue: number;
  costs: number;
  netProfit: number;
}

export interface ClientProfitAnalysis {
  totalRevenue: number;
  totalCosts: number;
  netProfit: number;
  marginPct: number;
  monthly: ProfitAnalysisPoint[];
}

export interface CurrencyFinancials {
  currency: string;
  tradeCount: number;
  revenue: number;
  costs: number;
  netProfit: number;
  avgProfit: number;
  marginPct: number;
  frigo: number;
  shipping: number;
  insurance: number;
  bankFees: number;
}

export interface DashboardMonthlyPoint {
  currency: string;
  month: string;
  tradeCount: number;
  revenue: number;
  costs: number;
  netProfit: number;
  avgProfit: number;
}

export interface PerformanceItem {
  tradeId: string;
  value: number;
  currency: string;
}

export interface ClientDashboard {
  tradeCount: number;
  currencies: string[];
  primaryCurrency: string;
  multiCurrency: boolean;
  financialByCurrency: CurrencyFinancials[];
  monthly: DashboardMonthlyPoint[];
  statusCounts: Record<string, number>;
  payments: {
    pending: number;
    received: number;
    overdue: number;
    advanceReceived: number;
    balanceReceived: number;
    receivedAmount: number;
    outstandingAmount: number;
    totalAmount: number;
    collectionPct: number;
    avgPaymentDelayDays: number;
  };
  documents: { total: number; signed: number; bol: number; additional: number };
  activity: {
    firstTradeDate: string | null;
    lastTradeDate: string | null;
    tradeCount: number;
    daysSinceLastTrade: number | null;
    avgTradesPerMonth: number;
    avgDaysBetweenTrades: number | null;
  };
  performance: {
    largestSale: PerformanceItem | null;
    largestProfit: PerformanceItem | null;
    highestShipping: PerformanceItem | null;
    highestBankFees: PerformanceItem | null;
    highestInsurance: PerformanceItem | null;
    highestMargin: PerformanceItem | null;
    lowestMargin: PerformanceItem | null;
  };
  recent: Array<{
    id: string;
    status: string;
    revenue: number;
    profit: number;
    currency: string;
    createdAt: string;
  }>;
  trend: {
    revenueChangePct: number | null;
    profitChangePct: number | null;
    volumeChangePct: number | null;
    currentMonth: string;
    previousMonth: string;
  } | null;
}

export type ClientInput = Partial<Omit<Client, 'id' | 'created_by' | 'created_at' | 'updated_at'>> & {
  name: string;
};

export const clientsApi = {
  list: async (search?: string): Promise<Client[]> => {
    const { data } = await api.get('/clients', { params: search ? { search } : undefined });
    return data;
  },
  get: async (id: string): Promise<Client> => {
    const { data } = await api.get(`/clients/${id}`);
    return data;
  },
  create: async (input: ClientInput): Promise<Client> => {
    const { data } = await api.post('/clients', input);
    return data;
  },
  update: async (id: string, input: Partial<ClientInput>): Promise<Client> => {
    const { data } = await api.put(`/clients/${id}`, input);
    return data;
  },
  remove: async (id: string): Promise<{ id: string }> => {
    const { data } = await api.delete(`/clients/${id}`);
    return data;
  },
  analytics: async (id: string): Promise<ClientAnalytics> => {
    const { data } = await api.get(`/clients/${id}/analytics`);
    return data;
  },
  trades: async (id: string): Promise<Trade[]> => {
    const { data } = await api.get(`/clients/${id}/trades`);
    return data;
  },
  financialSummary: async (id: string): Promise<ClientFinancialSummary> => {
    const { data } = await api.get(`/clients/${id}/financial-summary`);
    return data;
  },
  profitAnalysis: async (id: string): Promise<ClientProfitAnalysis> => {
    const { data } = await api.get(`/clients/${id}/profit-analysis`);
    return data;
  },
  dashboard: async (id: string): Promise<ClientDashboard> => {
    const { data } = await api.get(`/clients/${id}/dashboard`);
    return data;
  },
};

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  message: string | null;
  metadata: Record<string, any> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  user_email?: string | null;
}

export interface AuditListResult {
  logs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditListParams {
  search?: string;
  action?: string;
  entity_type?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
}

export const auditApi = {
  list: async (params: AuditListParams = {}): Promise<AuditListResult> => {
    const { data } = await api.get('/audit/logs', { params });
    return data;
  },
  entity: async (type: string, id: string, limit = 10): Promise<AuditLog[]> => {
    const { data } = await api.get(`/audit/entity/${type}/${id}`, { params: { limit } });
    return data;
  },
  // Fire-and-forget client event (auth). Never throws into the UI.
  event: async (action: string, message?: string, metadata?: Record<string, any>): Promise<void> => {
    try {
      await api.post('/audit/event', { action, message, metadata, entity_type: 'auth' });
    } catch {
      /* logging must never block the user */
    }
  },
};

export type UserRole = 'super_admin' | 'admin' | 'employee' | 'partner';

export interface AppUser {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean;
  invitation_status: string | null;
  invited_at: string | null;
  last_login_at: string | null;
  created_at: string;
}

export interface InviteResult {
  user: AppUser;
  invitationLink: string;
  emailSent: boolean;
  expiresAt: string;
  /** True when the email already belonged to an active account (re-invite was a no-op). */
  alreadyActive?: boolean;
}

export const usersApi = {
  list: async (params: { search?: string; role?: string } = {}): Promise<AppUser[]> => {
    const { data } = await api.get('/users', { params });
    return data;
  },
  invite: async (input: { email: string; full_name?: string; role: UserRole }): Promise<InviteResult> => {
    const { data } = await api.post('/users', input);
    return data;
  },
  update: async (id: string, input: { full_name?: string; role?: UserRole }): Promise<AppUser> => {
    const { data } = await api.put(`/users/${id}`, input);
    return data;
  },
  setActive: async (id: string, is_active: boolean): Promise<AppUser> => {
    const { data } = await api.patch(`/users/${id}/active`, { is_active });
    return data;
  },
  remove: async (id: string): Promise<{ id: string }> => {
    const { data } = await api.delete(`/users/${id}`);
    return data;
  },
};

export interface InvitationCheck {
  valid: boolean;
  reason?: string;
  email?: string;
  role?: string;
  expiresAt?: string;
}

export const authApi = {
  me: async (): Promise<AppUser> => {
    const { data } = await api.get('/auth/me');
    return data;
  },
  session: async (): Promise<AppUser> => {
    const { data } = await api.post('/auth/session', {});
    return data;
  },
  logout: async (): Promise<void> => {
    try { await api.post('/auth/logout', {}); } catch { /* best-effort */ }
  },
  validateInvite: async (token: string): Promise<InvitationCheck> => {
    const { data } = await api.get(`/auth/invitation/${token}`);
    return data;
  },
  acceptInvite: async (token: string, password: string): Promise<{ email: string }> => {
    const { data } = await api.post('/auth/accept-invite', { token, password });
    return data;
  },
};

// ---- Bank Profiles ---------------------------------------------------------

export interface BankProfile {
  id: string;
  profile_name: string;
  beneficiary_name: string;
  beneficiary_address: string | null;
  intermediary_bank_name: string | null;
  intermediary_bank_swift: string | null;
  intermediary_bank_address: string | null;
  bank_name: string;
  bank_swift: string | null;
  account_number: string | null;
  iban: string | null;
  ara_number: string | null;
  field_71a: string | null;
  currency: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface BankProfileInput {
  profile_name: string;
  beneficiary_name: string;
  beneficiary_address?: string | null;
  intermediary_bank_name?: string | null;
  intermediary_bank_swift?: string | null;
  intermediary_bank_address?: string | null;
  bank_name: string;
  bank_swift?: string | null;
  account_number?: string | null;
  iban?: string | null;
  ara_number?: string | null;
  field_71a?: string | null;
  currency?: string | null;
  is_default?: boolean;
}

export interface BankProfileTrade {
  id: string;
  trade_reference: string | null;
  status: string;
  created_at: string;
  client_name: string | null;
}

export const bankProfilesApi = {
  list: async (): Promise<BankProfile[]> => {
    const { data } = await api.get('/bank-profiles');
    return data;
  },
  get: async (id: string): Promise<BankProfile> => {
    const { data } = await api.get(`/bank-profiles/${id}`);
    return data;
  },
  create: async (input: BankProfileInput): Promise<BankProfile> => {
    const { data } = await api.post('/bank-profiles', input);
    return data;
  },
  update: async (id: string, input: Partial<BankProfileInput>): Promise<BankProfile> => {
    const { data } = await api.put(`/bank-profiles/${id}`, input);
    return data;
  },
  remove: async (id: string): Promise<{ id: string }> => {
    const { data } = await api.delete(`/bank-profiles/${id}`);
    return data;
  },
  trades: async (id: string): Promise<BankProfileTrade[]> => {
    const { data } = await api.get(`/bank-profiles/${id}/trades`);
    return data;
  },
};

export const documentsApi = {
  list: async (tradeId: string): Promise<TradeDocument[]> => {
    const { data } = await api.get(`/trades/${tradeId}/documents`);
    return data;
  },
  upload: async (
    tradeId: string,
    file: File,
    docType: TradeDocumentType,
    bolDate?: string
  ): Promise<TradeDocument> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('doc_type', docType);
    if (bolDate) formData.append('bol_date', bolDate);
    const { data } = await api.post(`/trades/${tradeId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },
  remove: async (tradeId: string, docId: string): Promise<{ id: string }> => {
    const { data } = await api.delete(`/trades/${tradeId}/documents/${docId}`);
    return data;
  },
};
