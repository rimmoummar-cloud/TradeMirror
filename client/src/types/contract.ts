// Core domain types — single source of truth for data shapes.
//
// Extended for the Frigorifico Concepcion contract template. All fields added
// for real PDF extraction are OPTIONAL so existing pages/form/generator keep
// compiling and working unchanged.

export interface Client {
  id: string;
  name: string;
  address?: string;
  city?: string; // template has a separate City line
  email?: string;
  phone?: string;
  contactPerson?: string;
  vatNumber?: string; // R.U.C. / tax id
  country?: string;
}

/** One detected product-table row (spatial extraction supports multiple). */
export interface ProductLine {
  quantity: number;
  commodity: string;
  unitPrice: number;
  lineTotal: number;
}

export interface Trade {
  id: string;
  commodity: string; // product description
  quantity: number;
  unit: string; // "Ton", "MT", "kg"
  unitPrice: number;
  currency: string; // ISO 4217: "USD", "EUR"
  totalAmount?: number; // grand total from the contract
  lines?: ProductLine[]; // all detected product rows (multi-row layouts)
  incoterm?: string; // "CFR - ALEXANDRIA - EGYPT"
  origin?: string;
  destination?: string;
  shipmentDate?: string; // e.g. "LOADING FROM PLANT MAY/JUN"
  deliveryDate?: string;
  deliveryLocation?: string;
}

export interface BankAccount {
  bankName?: string;
  swift?: string;
  accountNumber?: string;
  address?: string;
}

export interface Banking {
  intermediaryBank?: BankAccount;
  beneficiaryBank?: BankAccount;
  beneficiary?: string;
}

export interface ContractData {
  contractNumber: string;
  contractDate: string; // ISO date (normalized from "APRIL 20/2026")
  contractDateRaw?: string; // original as printed
  salesPerson?: string;
  salesAssistant?: string;

  buyer: Client; // "Client" block (CHIPA TECH)
  seller: Client; // "Exporter" block (FRIGORIFICO)
  trade: Trade;

  freightCondition?: string; // "PREPAID"
  paymentTerms?: string; // composed prepayment + balance
  prepaymentCondition?: string;
  balanceCondition?: string;

  banking?: Banking;

  // logistics / commercial extras present on the template
  brand?: string;
  validity?: string;
  temperature?: string;
  packing?: string;
  plantNo?: string;
  lawJurisdiction?: string;

  notes?: string; // "Obs:" paragraph
}

export type ContractStatus =
  | "idle"
  | "parsing"
  | "ready"
  | "generating"
  | "error";

export interface ContractState {
  sourceFile: File | null;
  sourceBytes: ArrayBuffer | null; // original PDF bytes for template overlay
  original: ContractData | null; // immutable post-parse
  draft: ContractData | null; // editable copy
  status: ContractStatus;
  error?: string;

  // Id of the trade already created for the CURRENT sourceFile. Lives in the
  // store (not a component ref) so the "create once" guarantee survives the
  // Upload page being unmounted/remounted (sidebar navigation, route re-entry).
  // Reset whenever a new file is parsed.
  createdTradeId: string | null;

  // actions
  parseFile: (file: File) => Promise<void>;
  updateDraft: (draft: ContractData) => void;
  markCreated: (tradeId: string) => void;
  reset: () => void;
}
