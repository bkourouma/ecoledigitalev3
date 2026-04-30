import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";

export interface SuperAdminTokenPayload {
  iss: "ecoledigitale-super-admin";
  aud: "super-admin";
  sub: string;
  superAdminId: string;
  email: string;
  scope: "super_admin";
  iat: number;
  exp: number;
  jti: string;
}

const SUPER_ADMIN_JWT_SECRET = process.env.SUPER_ADMIN_JWT_SECRET || process.env.JWT_SECRET;

if (!SUPER_ADMIN_JWT_SECRET) {
  throw new Error("SUPER_ADMIN_JWT_SECRET or JWT_SECRET environment variable is required");
}

export function generateSuperAdminToken(superAdminId: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);

  const payload: SuperAdminTokenPayload = {
    iss: "ecoledigitale-super-admin",
    aud: "super-admin",
    sub: superAdminId,
    superAdminId,
    email,
    scope: "super_admin",
    iat: now,
    exp: now + 24 * 60 * 60,
    jti: randomUUID(),
  };

  return jwt.sign(payload, SUPER_ADMIN_JWT_SECRET!, {
    algorithm: "HS256",
  });
}

export function verifySuperAdminToken(token: string): SuperAdminTokenPayload {
  return jwt.verify(token, SUPER_ADMIN_JWT_SECRET!, {
    algorithms: ["HS256"],
    issuer: "ecoledigitale-super-admin",
    audience: "super-admin",
  }) as SuperAdminTokenPayload;
}

export function decodeSuperAdminToken(token: string): SuperAdminTokenPayload | null {
  try {
    return jwt.decode(token) as SuperAdminTokenPayload;
  } catch {
    return null;
  }
}
