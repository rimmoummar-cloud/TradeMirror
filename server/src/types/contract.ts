// ---------------------------------------------------------------------------
// ContractData domain types (server copy)
//
// Mirrors the frontend's `ContractData` shape (client/src/types/contract.ts).
// This is the structure the edited_data JSON takes after the user saves the
// edit form, and it is the input the legacy PDF overlay engine consumes.
//
// Only the data shapes are copied here (not the browser-only `ContractState`).
// ---------------------------------------------------------------------------

export interface Client {
  id: string;
  name: string;
  address?: string;
  city?: string;
  email?: string;
  phone?: string;
  contactPerson?: string;
  vatNumber?: string; // R.U.C. / tax id
  country?: string;
}

export interface ProductLine {
  quantity: number;
  commodity: string;
  unitPrice: number;
  lineTotal: number;
}

export interface Trade {
  id: string;
  commodity: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  currency: string;
  totalAmount?: number;
  lines?: ProductLine[];
  incoterm?: string;
  origin?: string;
  destination?: string;
  shipmentDate?: string;
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
  contractDate: string;
  contractDateRaw?: string;
  salesPerson?: string;
  salesAssistant?: string;

  buyer: Client;
  seller: Client;
  trade: Trade;

  freightCondition?: string;
  paymentTerms?: string;
  prepaymentCondition?: string;
  balanceCondition?: string;

  banking?: Banking;

  brand?: string;
  validity?: string;
  temperature?: string;
  packing?: string;
  plantNo?: string;
  lawJurisdiction?: string;

  notes?: string;
}

/** Runtime guard: does this JSON look like a full ContractData (not the flat
 * server-parsed fields)? The overlay engine requires the nested `.trade`,
 * `.buyer`, `.seller` blocks the edit form produces. */
export function isContractData(value: unknown): value is ContractData {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.trade === "object" &&
    v.trade !== null &&
    typeof v.buyer === "object" &&
    typeof v.seller === "object"
  );
}
