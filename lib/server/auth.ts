import { verifyFirebaseIdToken } from "@/lib/entitlements";
import { isAdminUser } from "@/lib/admin";

export interface VerifiedCaller {
  uid: string;
  email?: string;
}

/**
 * Extracts a Bearer token from an Authorization header value.
 */
export function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

/**
 * Resolves the caller's verified identity, or null when the token is missing or invalid.
 */
export async function getVerifiedCaller(authHeader: string | null | undefined): Promise<VerifiedCaller | null> {
  const token = extractBearerToken(authHeader);
  if (!token) return null;
  return verifyFirebaseIdToken(token);
}

export type AdminCheck =
  | { ok: true; caller: VerifiedCaller }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Fail-closed admin authorization: a missing, invalid or non-admin token is always rejected.
 */
export async function requireAdmin(authHeader: string | null | undefined): Promise<AdminCheck> {
  const token = extractBearerToken(authHeader);
  if (!token) {
    return { ok: false, status: 401, error: "Unauthorized. Missing admin Bearer token." };
  }
  const caller = await verifyFirebaseIdToken(token);
  if (!caller || !isAdminUser(caller.email)) {
    return { ok: false, status: 403, error: "Forbidden. Authorized administrator access required." };
  }
  return { ok: true, caller };
}
