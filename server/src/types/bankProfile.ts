// ---------------------------------------------------------------------------
// Bank Profile domain types
//
// A `BankProfile` stores the beneficiary banking details used to populate the
// "Beneficiary's Bank" section of generated contracts. This module is
// standalone — it is NOT linked to the trade flow.
// ---------------------------------------------------------------------------

/** A row in the `bank_profiles` table. */
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
  beneficiary_country: string | null;
  currency: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** A trade linked to a bank profile (flattened for the detail page table). */
export interface BankProfileTrade {
  id: string;
  trade_reference: string | null;
  status: string;
  created_at: string;
  client_name: string | null;
}

/** Fields accepted when creating/updating a bank profile. */
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
  beneficiary_country?: string | null;
  currency?: string | null;
  is_default?: boolean;
}
