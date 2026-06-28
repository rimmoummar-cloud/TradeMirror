export const USER_ROLES = ["super_admin", "admin", "employee", "partner"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isValidRole(r: unknown): r is UserRole {
  return typeof r === "string" && (USER_ROLES as readonly string[]).includes(r);
}

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
