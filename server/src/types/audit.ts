// ---------------------------------------------------------------------------
// Audit log domain types + the canonical action vocabulary.
// ---------------------------------------------------------------------------

/** Structured, ENUM-style event names. Keep these stable — they are queried. */
export const AUDIT_ACTIONS = {
  // Trade lifecycle
  TRADE_CREATED: "TRADE_CREATED",
  TRADE_UPDATED: "TRADE_UPDATED",
  TRADE_STATUS_CHANGED: "TRADE_STATUS_CHANGED",
  TRADE_DELETED: "TRADE_DELETED",
  PDF_UPLOADED: "PDF_UPLOADED",
  CONTRACT_GENERATED: "CONTRACT_GENERATED",
  CONTRACT_REGENERATED: "CONTRACT_REGENERATED",
  VERSION_CREATED: "VERSION_CREATED",
  // Financial integrity
  UNIT_PRICE_UPDATED: "UNIT_PRICE_UPDATED",
  SALE_PRICE_UPDATED: "SALE_PRICE_UPDATED",
  TRADE_RECALCULATED: "TRADE_RECALCULATED",
  // Clients
  CLIENT_CREATED: "CLIENT_CREATED",
  CLIENT_UPDATED: "CLIENT_UPDATED",
  CLIENT_DELETED: "CLIENT_DELETED",
  // Bank profiles
  BANK_PROFILE_CREATED: "BANK_PROFILE_CREATED",
  BANK_PROFILE_UPDATED: "BANK_PROFILE_UPDATED",
  BANK_PROFILE_DELETED: "BANK_PROFILE_DELETED",
  // Documents
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  DOCUMENT_DELETED: "DOCUMENT_DELETED",
  // Authentication
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGOUT: "LOGOUT",
  // User management
  USER_INVITED: "USER_INVITED",
  USER_INVITATION_ACCEPTED: "USER_INVITATION_ACCEPTED",
  USER_LOGIN_SUCCESS: "USER_LOGIN_SUCCESS",
  USER_LOGOUT: "USER_LOGOUT",
  USER_CREATED: "USER_CREATED",
  USER_UPDATED: "USER_UPDATED",
  USER_DELETED: "USER_DELETED",
  USER_ROLE_CHANGED: "USER_ROLE_CHANGED",
  USER_ACTIVATED: "USER_ACTIVATED",
  USER_DEACTIVATED: "USER_DEACTIVATED",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditEntityType = "trade" | "client" | "document" | "auth" | "user" | "bank_profile";

/** What a caller provides to record one audit event. */
export interface AuditInput {
  userId?: string | null;
  action: string;
  entityType?: AuditEntityType | null;
  entityId?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** A row as returned to the API (with the resolved actor email). */
export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  message: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  user_email?: string | null; // resolved from public.users for display
}
