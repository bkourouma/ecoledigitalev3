import bcrypt from "bcryptjs";

export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function extractTenantFromHost(host: string): string | null {
  if (!host) return null;
  
  const parts = host.split(".");
  if (parts.length < 2) return null;
  
  const subdomain = parts[0];
  
  // Skip common non-tenant subdomains
  if (["www", "api", "admin", "ecoledigitale", "localhost"].includes(subdomain)) {
    return null;
  }
  
  return subdomain;
}











