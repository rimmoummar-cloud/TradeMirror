// ---------------------------------------------------------------------------
// Client domain types
//
// A `Client` is the single source of truth for buyer/contact identity. Trades
// reference it via trades.client_id (1 client -> many trades).
// ---------------------------------------------------------------------------

/** A row in the `clients` table. */
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

/** Fields accepted when creating/updating a client. */
export interface ClientInput {
  name: string;
  tax_id?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  contact_person?: string | null;
}

/**
 * Loose buyer shape lifted from a PDF (extracted_data) or the edit form
 * (edited_data). Mirrors the frontend ContractData.Client (vatNumber = tax id).
 */
export interface BuyerLike {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  vatNumber?: string; // tax id
  contactPerson?: string;
}

/** Real-time analytics computed from this client's trades. */
export interface ClientAnalytics {
  totalTrades: number;
  totalRevenue: number;
  totalCosts: number;
  netProfit: number;
  averageProfitPerTrade: number;
  lastTradeDate: string | null;
}

/** Aggregated financial summary (one client, all trades) from SQL. */
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

/** One month of profit history. */
export interface ProfitAnalysisPoint {
  month: string; // YYYY-MM-01
  tradeCount: number;
  revenue: number;
  costs: number;
  netProfit: number;
}

/** Profit analysis: overall figures + a monthly series. */
export interface ClientProfitAnalysis {
  totalRevenue: number;
  totalCosts: number;
  netProfit: number;
  marginPct: number; // net profit / revenue * 100
  monthly: ProfitAnalysisPoint[];
}

// ---- Full BI dashboard (single SQL aggregation) ---------------------------

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

export interface MonthlyPoint {
  currency: string;
  month: string; // YYYY-MM-DD (first of month)
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

export interface DashboardTrend {
  revenueChangePct: number | null;
  profitChangePct: number | null;
  volumeChangePct: number | null;
  currentMonth: string;
  previousMonth: string;
}

export interface ClientDashboard {
  tradeCount: number;
  currencies: string[];
  primaryCurrency: string;
  multiCurrency: boolean;
  financialByCurrency: CurrencyFinancials[];
  monthly: MonthlyPoint[];
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
  trend: DashboardTrend | null;
}
