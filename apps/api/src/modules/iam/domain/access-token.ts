/**
 * Jetons JWT du module iam.
 *
 *  - ACCÈS (`typ: at+jwt`, 15 min) : revendications compatibles avec le jeton
 *    historique (`userId`, `tenantId`, `tenantSlug`, `roles`, `activeRole`, `jti`,
 *    `iss`, `aud` = slug du tenant, `sub`) + `sid` (session), `mid` (membership),
 *    `mfa`/`amr` (facteurs satisfaits). `userId` = identifiant de l'IDENTITÉ globale.
 *  - IMPERSONATION (`typ: imp+jwt`) : mêmes revendications + `act` (acteur réel,
 *    le super-admin). Jamais renouvelable.
 *  - ÉTAPE (`typ: mfa+jwt` challenge, `enr+jwt` enrôlement) : porte uniquement
 *    l'identifiant d'une ligne `login_challenges` ; signé avec une clé différente.
 *
 * Ordre de confiance : signature → en-tête → forme des revendications → dates →
 * cohérence (aud = tenantSlug). Le tenant du jeton n'est exploité qu'ensuite, et
 * l'appelant le confronte encore à la session en base.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { UnauthorizedError, type Clock, type Result, err, ok } from "@ecoledigitale/kernel";
import { AuthErrorCodes } from "@ecoledigitale/contracts/v2/iam";
import type { IamConfig } from "../config";
import { JwtError, peekJwtTyp, signJwt, verifyJwt, type JwtTyp } from "./tokens";

const uuid = z.string().uuid();
const roleKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

const baseClaims = {
  iss: z.literal("ecoledigitale"),
  aud: z.string().min(1).max(100),
  sub: uuid,
  iat: z.number().int().positive(),
  nbf: z.number().int().positive().optional(),
  exp: z.number().int().positive(),
  jti: uuid,
  userId: uuid,
  scope: z.literal("tenant_user"),
  tenantId: uuid,
  tenantSlug: z.string().min(1).max(100),
  roles: z.array(roleKey).min(1).max(32),
  activeRole: roleKey,
  sid: uuid,
  mid: uuid,
  mfa: z.boolean(),
  amr: z.array(z.enum(["pwd", "otp", "rcv", "imp"])).max(4),
};

export const AccessClaimsSchema = z
  .object({ ...baseClaims, use: z.literal("access") })
  .strict()
  .refine((c) => c.sub === c.userId, { message: "sub != userId" })
  .refine((c) => c.aud === c.tenantSlug, { message: "aud != tenantSlug" })
  .refine((c) => c.roles.includes(c.activeRole), { message: "activeRole absent de roles" });

export const ImpersonationClaimsSchema = z
  .object({
    ...baseClaims,
    use: z.literal("impersonation"),
    act: z.object({ sub: uuid, typ: z.literal("super_admin") }).strict(),
  })
  .strict()
  .refine((c) => c.sub === c.userId, { message: "sub != userId" })
  .refine((c) => c.aud === c.tenantSlug, { message: "aud != tenantSlug" })
  .refine((c) => c.roles.includes(c.activeRole), { message: "activeRole absent de roles" });

export type AccessClaims = z.infer<typeof AccessClaimsSchema>;
export type ImpersonationClaims = z.infer<typeof ImpersonationClaimsSchema>;
/** Revendications d'un jeton « porteur » valide (accès ou impersonation). */
export type BearerClaims = AccessClaims | ImpersonationClaims;

export interface IssueAccessInput {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  roles: readonly string[];
  activeRole: string;
  sessionId: string;
  membershipId: string;
  mfa: boolean;
  amr: readonly ("pwd" | "otp" | "rcv" | "imp")[];
  /** Présent = jeton d'impersonation. */
  actor?: { id: string };
  ttlSec?: number;
}

export interface IssuedToken<C> {
  token: string;
  claims: C;
  expiresAt: Date;
}

const nowSec = (clock: Clock): number => Math.floor(clock.now().getTime() / 1000);

export function issueBearerToken(config: IamConfig, clock: Clock, input: IssueAccessInput): IssuedToken<BearerClaims> {
  const iat = nowSec(clock);
  const ttl = input.ttlSec ?? (input.actor ? config.impersonationTtlSec : config.accessTtlSec);
  const base = {
    iss: config.issuer,
    aud: input.tenantSlug,
    sub: input.userId,
    iat,
    nbf: iat,
    exp: iat + ttl,
    jti: randomUUID(),
    userId: input.userId,
    scope: "tenant_user" as const,
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    roles: [...input.roles],
    activeRole: input.activeRole,
    sid: input.sessionId,
    mid: input.membershipId,
    mfa: input.mfa,
    amr: [...input.amr],
  };
  const claims: BearerClaims = input.actor
    ? ImpersonationClaimsSchema.parse({ ...base, use: "impersonation", act: { sub: input.actor.id, typ: "super_admin" } })
    : AccessClaimsSchema.parse({ ...base, use: "access" });
  const token = signJwt(claims as unknown as Record<string, unknown>, config.keys.bearer, input.actor ? "imp+jwt" : "at+jwt");
  return { token, claims, expiresAt: new Date((iat + ttl) * 1000) };
}

const fail = (code: string, message = "Authentification requise."): Result<never, UnauthorizedError> =>
  err(new UnauthorizedError(message, { code }));

/**
 * Vérifie un jeton porteur : signature, en-tête, forme, dates. Ne consulte pas
 * la base : la révocation est contrôlée par `buildRequestContextFromToken`.
 * Les messages d'erreur sont génériques ; le code distingue seulement
 * « expiré » (le client peut rafraîchir) de « invalide ».
 */
export function verifyAccessToken(
  token: string,
  options: { config: Pick<IamConfig, "keys" | "issuer" | "clockToleranceSec">; clock: Clock; allowImpersonation?: boolean },
): Result<BearerClaims, UnauthorizedError> {
  const { config, clock } = options;
  let payload: Record<string, unknown>;
  try {
    payload = verifyJwt(token, config.keys.bearer, options.allowImpersonation === false ? ["at+jwt"] : ["at+jwt", "imp+jwt"]);
  } catch (e) {
    if (e instanceof JwtError) return fail(AuthErrorCodes.tokenInvalid);
    throw e;
  }

  const parsed = payload.use === "impersonation" ? ImpersonationClaimsSchema.safeParse(payload) : AccessClaimsSchema.safeParse(payload);
  if (!parsed.success) return fail(AuthErrorCodes.tokenInvalid);
  const claims = parsed.data as BearerClaims;

  // `typ` (en-tête, désormais authentifié) et `use` (payload) doivent concorder :
  // un jeton d'impersonation ne se fait pas passer pour un jeton d'accès, ni l'inverse.
  const typ = peekJwtTyp(token);
  if ((claims.use === "access" && typ !== "at+jwt") || (claims.use === "impersonation" && typ !== "imp+jwt")) {
    return fail(AuthErrorCodes.tokenInvalid);
  }
  if (claims.iss !== config.issuer) return fail(AuthErrorCodes.tokenInvalid);

  const now = nowSec(clock);
  const tol = config.clockToleranceSec;
  if (claims.exp + tol <= now) return fail(AuthErrorCodes.tokenExpired);
  if (claims.iat - tol > now) return fail(AuthErrorCodes.tokenInvalid);
  if (claims.nbf !== undefined && claims.nbf - tol > now) return fail(AuthErrorCodes.tokenInvalid);
  if (claims.exp <= claims.iat) return fail(AuthErrorCodes.tokenInvalid);
  return ok(claims);
}

// -----------------------------------------------------------------------------
// Jetons d'étape : challenge MFA et enrôlement
// -----------------------------------------------------------------------------

export type StepPurpose = "mfa_challenge" | "mfa_enroll";

const StepClaimsSchema = z
  .object({
    iss: z.literal("ecoledigitale"),
    aud: z.literal("ecoledigitale:iam:step"),
    sub: uuid,
    iat: z.number().int().positive(),
    exp: z.number().int().positive(),
    jti: uuid,
    use: z.enum(["mfa_challenge", "mfa_enroll"]),
    tid: uuid,
    cid: uuid,
  })
  .strict();

export type StepClaims = z.infer<typeof StepClaimsSchema>;

export function issueStepToken(
  config: IamConfig,
  clock: Clock,
  input: { purpose: StepPurpose; identityId: string; tenantId: string; challengeId: string; ttlSec: number },
): IssuedToken<StepClaims> {
  const iat = nowSec(clock);
  const claims = StepClaimsSchema.parse({
    iss: config.issuer,
    aud: "ecoledigitale:iam:step",
    sub: input.identityId,
    iat,
    exp: iat + input.ttlSec,
    jti: randomUUID(),
    use: input.purpose,
    tid: input.tenantId,
    cid: input.challengeId,
  });
  const token = signJwt(claims, config.keys.step, input.purpose === "mfa_challenge" ? "mfa+jwt" : "enr+jwt");
  return { token, claims, expiresAt: new Date((iat + input.ttlSec) * 1000) };
}

export function verifyStepToken(
  token: string,
  purpose: StepPurpose,
  options: { config: Pick<IamConfig, "keys" | "issuer" | "clockToleranceSec">; clock: Clock },
): Result<StepClaims, UnauthorizedError> {
  const typ: JwtTyp = purpose === "mfa_challenge" ? "mfa+jwt" : "enr+jwt";
  let payload: Record<string, unknown>;
  try {
    payload = verifyJwt(token, options.config.keys.step, [typ]);
  } catch (e) {
    if (e instanceof JwtError) return fail(AuthErrorCodes.mfaChallengeInvalid);
    throw e;
  }
  const parsed = StepClaimsSchema.safeParse(payload);
  if (!parsed.success || parsed.data.use !== purpose || parsed.data.iss !== options.config.issuer) {
    return fail(AuthErrorCodes.mfaChallengeInvalid);
  }
  const now = nowSec(options.clock);
  if (parsed.data.exp + options.config.clockToleranceSec <= now) return fail(AuthErrorCodes.mfaChallengeInvalid);
  if (parsed.data.iat - options.config.clockToleranceSec > now) return fail(AuthErrorCodes.mfaChallengeInvalid);
  return ok(parsed.data);
}
