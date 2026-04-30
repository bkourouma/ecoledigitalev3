const ADMIN_EMAILS = (process.env.FORMATION_PUBLIC_ADMIN_EMAILS || "")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

export function isPortalAdminEmail(email?: string | null) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

export function isPlaceholderTrainerEmail(email?: string | null) {
  return Boolean(email?.toLowerCase().endsWith("@formation-pro.local"));
}

export function formatTenantLabel(tenantId: string) {
  return `Tenant ${tenantId.slice(0, 8)}`;
}
