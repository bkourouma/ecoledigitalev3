/**
 * All tenants share the same Formation Pro experience: session-based catalogue
 * with calendar, sessions and formateurs management.
 *
 * The previous Imhotep Data / ASPCI gates have been removed — every admin
 * tenant gets the same UI. Keep the helper in place so existing callers don't
 * break; the parameter is ignored and the answer is always `true`.
 */
export function usesSessionBasedProfessionalCatalogue(_tenantId?: string | undefined): boolean {
  return true;
}
