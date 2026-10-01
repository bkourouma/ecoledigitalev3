/**
 * JWT Service
 * 
 * Handles JWT token generation, validation, and decoding for authentication.
 * Uses HS256 algorithm with JWT_SECRET from environment variables.
 * 
 * Security Features:
 * - Cryptographic signing with HS256 (HMAC-SHA256)
 * - 24-hour token expiration
 * - Issuer validation ("ecoledigitale")
 * - Audience validation (tenant slug)
 * - Signature verification on every request
 */

import jwt from 'jsonwebtoken';
import { JWTPayload } from '@ecoledigitale/contracts';
import { randomUUID } from 'crypto';

/**
 * JWT Configuration
 */
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const JWT_ISSUER = 'ecoledigitale';

// Validate JWT_SECRET exists and is strong enough
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

if (JWT_SECRET.length < 32) {
  console.warn('⚠️ WARNING: JWT_SECRET should be at least 32 characters for security');
}

/**
 * Generate a new JWT token
 * 
 * @param payload - JWT payload containing user, tenant, and active role information
 * @returns Signed JWT token string
 */
export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp' | 'jti'>): string {
  // Generate unique JWT ID for blacklist lookup
  const jti = randomUUID();
  
  // Calculate timestamps
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (24 * 60 * 60); // 24 hours from now
  
  // Complete payload with standard claims
  const fullPayload: JWTPayload = {
    ...payload,
    jti,
    iat: now,
    exp
  };
  
  // Sign and return token
  const token = jwt.sign(fullPayload, JWT_SECRET!, {
    algorithm: 'HS256'
  });
  
  console.log(
    `JWT token generated for user ${payload.userId.substring(0, 8)}... with active role ${payload.activeRole}`
  );
  
  return token;
}

/**
 * Verify and decode a JWT token
 * 
 * Validates:
 * - Signature (using JWT_SECRET)
 * - Expiration (exp claim)
 * - Issuer (iss claim)
 * 
 * @param token - JWT token string
 * @returns Decoded JWT payload
 * @throws Error if token is invalid, expired, or has wrong issuer
 */
export function verifyToken(token: string): JWTPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET!, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER
    }) as JWTPayload;
    
    console.log(`✅ JWT token validated for user: ${decoded.userId.substring(0, 8)}...`);
    
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      console.error('❌ JWT validation failed: Token expired');
      throw new Error('Token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      console.error('❌ JWT validation failed: Invalid signature');
      throw new Error('Invalid token signature');
    } else {
      console.error('❌ JWT validation failed:', error);
      throw new Error('Token validation failed');
    }
  }
}

/**
 * Vérification silencieuse (signature HS256, expiration, émetteur) : `null` si le jeton n'est pas valide, sans
 * exception ni journal. Sert à décider si un jeton peut désigner un tenant (plugins/tenant-context.ts) : le tenant
 * d'un jeton NON vérifié ne doit jamais être lu, même sur une route publique.
 */
export function verifyTokenQuiet(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET!, { algorithms: ['HS256'], issuer: JWT_ISSUER }) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Decode a JWT token WITHOUT verification
 * 
 * Used for extracting claims when we need token info before validation
 * (e.g., to get jti for blacklist check).
 * 
 * ⚠️ WARNING: Do NOT trust the decoded payload without verification!
 * This is only for reading claims, not for authentication.
 * 
 * @param token - JWT token string
 * @returns Decoded JWT payload or null if decode fails
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.decode(token) as JWTPayload;
    return decoded;
  } catch (error) {
    console.error('❌ JWT decode failed:', error);
    return null;
  }
}

/**
 * Extract token from Authorization header
 * 
 * @param authHeader - Authorization header value (e.g., "Bearer eyJhbGc...")
 * @returns JWT token string or null if invalid format
 */
export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    console.error('❌ Invalid Authorization header format (expected "Bearer <token>")');
    return null;
  }
  
  return parts[1];
}

/**
 * Calculate token expiration date from exp claim
 * 
 * @param exp - Expiration timestamp (Unix seconds)
 * @returns ISO 8601 date string
 */
export function getExpirationDate(exp: number): string {
  return new Date(exp * 1000).toISOString();
}

/**
 * Check if token is close to expiration
 * 
 * @param exp - Expiration timestamp (Unix seconds)
 * @param minutesThreshold - Minutes before expiration to consider "close" (default: 5)
 * @returns True if token expires within threshold
 */
export function isTokenExpiringSoon(exp: number, minutesThreshold: number = 5): boolean {
  const now = Math.floor(Date.now() / 1000);
  const threshold = minutesThreshold * 60;
  return (exp - now) < threshold;
}











