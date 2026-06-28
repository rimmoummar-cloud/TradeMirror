import type { ContractData } from "../../types/contract";

/**
 * Flat form shape used by the edit form. Keeping the form flat (rather than the
 * nested ContractData) makes React Hook Form registration simple. Conversion
 * helpers map between the flat form and the nested domain model.
 */
export interface ContractFormValues {
  // contract
  contractNumber: string;
  contractDate: string;
  salesPerson: string;
  salesAssistant: string;

  // buyer
  buyerName: string;
  buyerAddress: string;
  buyerCity: string;
  buyerCountry: string;
  buyerContactPerson: string;
  buyerPhone: string;
  buyerEmail: string;

  // seller
  sellerName: string;
  sellerAddress: string;
  sellerCity: string;
  sellerCountry: string;
  sellerVatNumber: string;
  sellerEmail: string;

  // product
  commodity: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalAmount: number;
  currency: string;
  incoterm: string;

  // logistics
  origin: string;
  destination: string;
  shipmentDate: string;
  freightCondition: string;

  // payment terms
  prepaymentCondition: string;
  balanceCondition: string;

  // NOTE: Banking fields are intentionally NOT part of the editable form.
  // Beneficiary bank details are sourced solely from the selected Bank Profile
  // and injected at PDF generation time. The contract's existing banking block
  // is preserved untouched (see applyFormValues) so legacy trades keep working.

  // commercial
  brand: string;
  validity: string;
  temperature: string;
  packing: string;
  plantNo: string;
  lawJurisdiction: string;
  notes: string;
}

export function toFormValues(c: ContractData): ContractFormValues {
  return {
    contractNumber: c.contractNumber,
    contractDate: c.contractDate,
    salesPerson: c.salesPerson ?? "",
    salesAssistant: c.salesAssistant ?? "",

    buyerName: c.buyer.name,
    buyerAddress: c.buyer.address ?? "",
    buyerCity: c.buyer.city ?? "",
    buyerCountry: c.buyer.country ?? "",
    buyerContactPerson: c.buyer.contactPerson ?? "",
    buyerPhone: c.buyer.phone ?? "",
    buyerEmail: c.buyer.email ?? "",

    sellerName: c.seller.name,
    sellerAddress: c.seller.address ?? "",
    sellerCity: c.seller.city ?? "",
    sellerCountry: c.seller.country ?? "",
    sellerVatNumber: c.seller.vatNumber ?? "",
    sellerEmail: c.seller.email ?? "",

    commodity: c.trade.commodity,
    quantity: c.trade.quantity,
    unit: c.trade.unit,
    unitPrice: c.trade.unitPrice,
    totalAmount: c.trade.totalAmount ?? 0,
    currency: c.trade.currency,
    incoterm: c.trade.incoterm ?? "",

    origin: c.trade.origin ?? "",
    destination: c.trade.destination ?? "",
    shipmentDate: c.trade.shipmentDate ?? "",
    freightCondition: c.freightCondition ?? "",

    prepaymentCondition: c.prepaymentCondition ?? "",
    balanceCondition: c.balanceCondition ?? "",

    brand: c.brand ?? "",
    validity: c.validity ?? "",
    temperature: c.temperature ?? "",
    packing: c.packing ?? "",
    plantNo: c.plantNo ?? "",
    lawJurisdiction: c.lawJurisdiction ?? "",
    notes: c.notes ?? "",
  };
}

/** Merges edited form values back onto the original contract (keeps ids etc.). */
export function applyFormValues(
  base: ContractData,
  v: ContractFormValues
): ContractData {
  return {
    ...base,
    contractNumber: v.contractNumber,
    contractDate: v.contractDate,
    salesPerson: v.salesPerson,
    salesAssistant: v.salesAssistant,

    buyer: {
      ...base.buyer,
      name: v.buyerName,
      address: v.buyerAddress,
      city: v.buyerCity,
      country: v.buyerCountry,
      contactPerson: v.buyerContactPerson,
      phone: v.buyerPhone,
      email: v.buyerEmail,
    },
    seller: {
      ...base.seller,
      name: v.sellerName,
      address: v.sellerAddress,
      city: v.sellerCity,
      country: v.sellerCountry,
      vatNumber: v.sellerVatNumber,
      email: v.sellerEmail,
    },
    trade: {
      ...base.trade,
      commodity: v.commodity,
      quantity: Number(v.quantity),
      unit: v.unit,
      unitPrice: Number(v.unitPrice),
      totalAmount: Number(v.totalAmount),
      currency: v.currency,
      incoterm: v.incoterm,
      origin: v.origin,
      destination: v.destination,
      shipmentDate: v.shipmentDate,
    },

    freightCondition: v.freightCondition,
    prepaymentCondition: v.prepaymentCondition,
    balanceCondition: v.balanceCondition,
    // keep the composed paymentTerms in sync with the two edited conditions
    paymentTerms: [v.prepaymentCondition, v.balanceCondition]
      .filter(Boolean)
      .join(" | "),

    // Banking is no longer edited in the form — preserve the contract's existing
    // banking block exactly as-is. For trades with a Bank Profile, the profile is
    // injected over this block server-side at PDF generation. For legacy trades
    // (no profile) this keeps their original bank details intact on every save.
    banking: base.banking,

    brand: v.brand,
    validity: v.validity,
    temperature: v.temperature,
    packing: v.packing,
    plantNo: v.plantNo,
    lawJurisdiction: v.lawJurisdiction,
    notes: v.notes,
  };
}

// ---------------------------------------------------------------------------
// buildContractData — produce a COMPLETE ContractData from a backend trade.
//
// edited_data can be EITHER the nested ContractData (after a save) OR the flat
// server parse (right after upload). extracted_data is always the flat parse.
// toFormValues() reads c.buyer.name / c.trade.commodity WITHOUT optional
// chaining, so the object handed to the form MUST have every nested block
// present. This normaliser fills all of them so the editor can NEVER crash or
// be left without data, regardless of which shape the backend returned.
// ---------------------------------------------------------------------------
function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function asNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function buildContractData(editedData: unknown, extractedData: unknown): ContractData {
  const edited = (editedData ?? {}) as Record<string, any>;
  const extracted = (extractedData ?? {}) as Record<string, any>;

  // Is edited_data already the nested ContractData?
  const nested = edited && typeof edited === "object" && edited.trade ? edited : null;
  // Flat scalar source (extracted, overridden by edited when it's also flat).
  const flat = { ...extracted, ...(nested ? {} : edited) } as Record<string, any>;

  const buyer = (nested?.buyer ?? {}) as Record<string, any>;
  const seller = (nested?.seller ?? {}) as Record<string, any>;
  const t = (nested?.trade ?? {}) as Record<string, any>;
  const banking = (nested?.banking ?? {}) as Record<string, any>;
  const inter = (banking.intermediaryBank ?? {}) as Record<string, any>;
  const ben = (banking.beneficiaryBank ?? {}) as Record<string, any>;

  return {
    contractNumber: nested?.contractNumber ?? flat.contractNumber ?? "",
    contractDate: nested?.contractDate ?? flat.contractDate ?? "",
    contractDateRaw: nested?.contractDateRaw,
    salesPerson: nested?.salesPerson ?? "",
    salesAssistant: nested?.salesAssistant ?? "",

    buyer: {
      id: buyer.id ?? uid(),
      name: buyer.name ?? "",
      address: buyer.address ?? "",
      city: buyer.city ?? "",
      email: buyer.email ?? "",
      phone: buyer.phone ?? "",
      contactPerson: buyer.contactPerson ?? "",
      vatNumber: buyer.vatNumber ?? "",
      country: buyer.country ?? "",
    },
    seller: {
      id: seller.id ?? uid(),
      name: seller.name ?? "",
      address: seller.address ?? "",
      city: seller.city ?? "",
      email: seller.email ?? "",
      phone: seller.phone ?? "",
      contactPerson: seller.contactPerson ?? "",
      vatNumber: seller.vatNumber ?? "",
      country: seller.country ?? "",
    },
    trade: {
      id: t.id ?? uid(),
      commodity: t.commodity ?? flat.commodity ?? "",
      quantity: asNum(t.quantity ?? flat.quantity),
      unit: t.unit ?? flat.unit ?? "",
      unitPrice: asNum(t.unitPrice ?? flat.unitPrice),
      currency: t.currency ?? flat.currency ?? "USD",
      totalAmount: asNum(t.totalAmount ?? flat.totalAmount),
      incoterm: t.incoterm ?? flat.incoterm ?? "",
      origin: t.origin ?? "",
      destination: t.destination ?? "",
      shipmentDate: t.shipmentDate ?? "",
      deliveryDate: t.deliveryDate,
      deliveryLocation: t.deliveryLocation,
    },

    freightCondition: nested?.freightCondition ?? "",
    paymentTerms: nested?.paymentTerms,
    prepaymentCondition: nested?.prepaymentCondition ?? "",
    balanceCondition: nested?.balanceCondition ?? "",

    banking: {
      intermediaryBank: {
        bankName: inter.bankName ?? "",
        swift: inter.swift ?? "",
        accountNumber: inter.accountNumber ?? "",
        address: inter.address ?? "",
      },
      beneficiaryBank: {
        bankName: ben.bankName ?? "",
        swift: ben.swift ?? "",
        accountNumber: ben.accountNumber ?? "",
      },
      beneficiary: banking.beneficiary ?? "",
    },

    brand: nested?.brand ?? "",
    validity: nested?.validity ?? "",
    temperature: nested?.temperature ?? "",
    packing: nested?.packing ?? "",
    plantNo: nested?.plantNo ?? "",
    lawJurisdiction: nested?.lawJurisdiction ?? "",
    notes: nested?.notes ?? "",
  };
}
