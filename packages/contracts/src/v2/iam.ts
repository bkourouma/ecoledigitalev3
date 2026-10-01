/**
 * Contrats du module `iam` (identité, sessions, MFA) — API `/api/v1/iam/*`.
 *
 * Règles de lecture (ADR-008) :
 *  - toutes les requêtes sont `.strict()` : un champ inconnu est refusé (pas de
 *    « mass assignment » silencieux) ;
 *  - les mots de passe ne sont JAMAIS « trimés » ni normalisés ici ; seule une
 *    borne haute protège contre l'envoi de corps géants. La POLITIQUE de mot de
 *    passe (longueur, listes, e-mail) est appliquée par le module, pas par ces
 *    schémas ;
 *  - les réponses d'échec d'authentification sont génériques (voir `AuthErrorCodes`) ;
 *  - `refreshToken` n'apparaît dans une réponse que pour `client: "mobile"`. Pour
 *    `client: "web"` (défaut) il est posé en cookie httpOnly SameSite=Lax.
 */
import { z } from "zod";

/** Codes d'erreur STABLES (partie du contrat) ; le message affiché est traduit côté web. */
export const AuthErrorCodes = {
  invalidCredentials: "iam.invalid_credentials",
  tooManyAttempts: "iam.too_many_attempts",
  noActiveAccess: "iam.no_active_access",
  tokenInvalid: "iam.token_invalid",
  tokenExpired: "iam.token_expired",
  sessionRevoked: "iam.session_revoked",
  refreshInvalid: "iam.refresh_invalid",
  mfaRequired: "iam.mfa_required",
  mfaInvalidCode: "iam.mfa_invalid_code",
  mfaChallengeInvalid: "iam.mfa_challenge_invalid",
  mfaAlreadyEnabled: "iam.mfa_already_enabled",
  mfaNotEnabled: "iam.mfa_not_enabled",
  mfaMandatory: "iam.mfa_mandatory",
  passwordPolicy: "iam.password_policy", // secret-scan:allow (cle de configuration, pas un secret)
  resetTokenInvalid: "iam.reset_token_invalid",
  forbidden: "iam.forbidden",
  impersonationForbidden: "iam.impersonation_forbidden",
} as const;
export type AuthErrorCode = (typeof AuthErrorCodes)[keyof typeof AuthErrorCodes];

// -----------------------------------------------------------------------------
// Briques communes
// -----------------------------------------------------------------------------

const uuid = z.string().uuid();
export const IamEmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email()
  .transform((v) => v.toLowerCase());
/** Mot de passe tel que saisi : non modifié, borné. */
export const IamPasswordInputSchema = z.string().min(1).max(256);
export const IamSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/);
export const IamRoleKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const IamClientSchema = z.enum(["web", "mobile"]);
export const IamDeviceNameSchema = z.string().trim().min(1).max(80);
export const TotpCodeSchema = z.string().regex(/^\d{6}$/, "Code à 6 chiffres attendu.");
export const RecoveryCodeSchema = z.string().trim().regex(/^[A-Za-z0-9]{4}(-?[A-Za-z0-9]{4}){2}$/, "Code de secours invalide.");
export const OpaqueTokenSchema = z.string().min(20).max(512);

export const IamUserSummarySchema = z.object({
  id: uuid,
  email: z.string(),
  tenantId: uuid,
  tenantSlug: z.string(),
  activeRole: z.string(),
  roles: z.array(z.string()),
  availableRoles: z.array(z.string()),
  requiresRoleSelection: z.boolean(),
  mfaEnabled: z.boolean(),
});
export type IamUserSummary = z.infer<typeof IamUserSummarySchema>;

export const IamTenantSummarySchema = z.object({ id: uuid, slug: z.string(), name: z.string() });
export type IamTenantSummary = z.infer<typeof IamTenantSummarySchema>;

// -----------------------------------------------------------------------------
// Réponses d'authentification (union discriminée sur `status`)
// -----------------------------------------------------------------------------

export const AuthenticatedResponseSchema = z.object({
  status: z.literal("authenticated"),
  tokenType: z.literal("Bearer"),
  accessToken: z.string(),
  /** Durée de vie du jeton d'accès, en secondes. */
  expiresIn: z.number().int().positive(),
  /** Présent uniquement pour `client: "mobile"`. */
  refreshToken: z.string().optional(),
  refreshExpiresIn: z.number().int().positive().optional(),
  sessionId: uuid,
  user: IamUserSummarySchema,
  tenants: z.array(IamTenantSummarySchema),
});
export type AuthenticatedResponse = z.infer<typeof AuthenticatedResponseSchema>;

export const MfaRequiredResponseSchema = z.object({
  status: z.literal("mfa_required"),
  challengeToken: z.string(),
  expiresIn: z.number().int().positive(),
  methods: z.array(z.enum(["totp", "recovery_code"])),
});
export type MfaRequiredResponse = z.infer<typeof MfaRequiredResponseSchema>;

export const MfaEnrollmentRequiredResponseSchema = z.object({
  status: z.literal("mfa_enrollment_required"),
  enrollmentToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type MfaEnrollmentRequiredResponse = z.infer<typeof MfaEnrollmentRequiredResponseSchema>;

export const LoginResponseSchema = z.discriminatedUnion("status", [
  AuthenticatedResponseSchema,
  MfaRequiredResponseSchema,
  MfaEnrollmentRequiredResponseSchema,
]);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// -----------------------------------------------------------------------------
// Requêtes
// -----------------------------------------------------------------------------

export const LoginRequestSchema = z
  .object({
    email: IamEmailSchema,
    password: IamPasswordInputSchema,
    /** Établissement visé (sinon : dernier utilisé, ou l'unique accès). */
    tenantSlug: IamSlugSchema.optional(),
    activeRole: IamRoleKeySchema.optional(),
    client: IamClientSchema.default("web"),
    deviceName: IamDeviceNameSchema.optional(),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshResponseSchema = z.object({
  status: z.literal("refreshed"),
  tokenType: z.literal("Bearer"),
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  sessionId: uuid,
  refreshToken: z.string().optional(),
  refreshExpiresIn: z.number().int().positive().optional(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

export const MfaChallengeRequestSchema = z
  .object({
    challengeToken: OpaqueTokenSchema,
    code: TotpCodeSchema.optional(),
    recoveryCode: RecoveryCodeSchema.optional(),
    client: IamClientSchema.default("web"),
  })
  .strict()
  .refine((v) => (v.code === undefined) !== (v.recoveryCode === undefined), {
    message: "Fournir soit `code`, soit `recoveryCode`.",
  });
export type MfaChallengeRequest = z.infer<typeof MfaChallengeRequestSchema>;

export const RefreshRequestSchema = z
  .object({
    /** Corps = mobile. Pour le web, le jeton est dans le cookie httpOnly. */
    refreshToken: OpaqueTokenSchema.optional(),
    client: IamClientSchema.default("web"),
  })
  .strict();
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const LogoutRequestSchema = z.object({ refreshToken: OpaqueTokenSchema.optional() }).strict();
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

export const SwitchTenantRequestSchema = z
  .object({ tenantId: uuid, client: IamClientSchema.default("web") })
  .strict();
export type SwitchTenantRequest = z.infer<typeof SwitchTenantRequestSchema>;

export const SessionSummarySchema = z.object({
  id: uuid,
  current: z.boolean(),
  kind: z.enum(["user", "impersonation"]),
  activeRole: z.string(),
  mfaVerified: z.boolean(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  deviceName: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export const SessionListResponseSchema = z.object({ sessions: z.array(SessionSummarySchema) });
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

export const PasswordChangeRequestSchema = z
  .object({
    currentPassword: IamPasswordInputSchema,
    newPassword: IamPasswordInputSchema,
    client: IamClientSchema.default("web"),
  })
  .strict();
export type PasswordChangeRequest = z.infer<typeof PasswordChangeRequestSchema>;

export const PasswordForgotRequestSchema = z.object({ email: IamEmailSchema }).strict();
export type PasswordForgotRequest = z.infer<typeof PasswordForgotRequestSchema>;

export const PasswordResetRequestSchema = z
  .object({ token: OpaqueTokenSchema, newPassword: IamPasswordInputSchema })
  .strict();
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

// MFA -------------------------------------------------------------------------

/**
 * Le mot de passe est OBLIGATOIRE avec un jeton d'accès (ré-authentification : un
 * jeton volé ne doit pas suffire à enrôler le TOTP de l'attaquant) ; inutile avec
 * un `enrollmentToken` (le mot de passe vient d'être vérifié au login).
 */
export const MfaEnrollRequestSchema = z.object({ password: IamPasswordInputSchema.optional() }).strict();
export type MfaEnrollRequest = z.infer<typeof MfaEnrollRequestSchema>;

export const MfaEnrollResponseSchema = z.object({
  /** À afficher en QR code côté client. */
  otpauthUri: z.string(),
  /** Secret en base32, pour la saisie manuelle. Affiché UNE fois. */
  secret: z.string(),
  issuer: z.string(),
  accountName: z.string(),
  digits: z.literal(6),
  period: z.literal(30),
  algorithm: z.literal("SHA1"),
});
export type MfaEnrollResponse = z.infer<typeof MfaEnrollResponseSchema>;

export const MfaVerifyRequestSchema = z
  .object({ code: TotpCodeSchema, client: IamClientSchema.default("web") })
  .strict();
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequestSchema>;

export const MfaVerifyResponseSchema = z.object({
  /** Codes de secours : affichés UNE seule fois, à usage unique. */
  recoveryCodes: z.array(z.string()),
  /** Présent quand l'enrôlement faisait suite à `mfa_enrollment_required`. */
  session: AuthenticatedResponseSchema.optional(),
});
export type MfaVerifyResponse = z.infer<typeof MfaVerifyResponseSchema>;

export const MfaDisableRequestSchema = z
  .object({
    password: IamPasswordInputSchema,
    code: TotpCodeSchema.optional(),
    recoveryCode: RecoveryCodeSchema.optional(),
    client: IamClientSchema.default("web"),
  })
  .strict()
  .refine((v) => (v.code === undefined) !== (v.recoveryCode === undefined), {
    message: "Fournir soit `code`, soit `recoveryCode`.",
  });
export type MfaDisableRequest = z.infer<typeof MfaDisableRequestSchema>;

// Administration du tenant -----------------------------------------------------

export const MemberStatusSchema = z.enum(["invited", "active", "suspended", "revoked"]);
export type MemberStatus = z.infer<typeof MemberStatusSchema>;

export const MemberSummarySchema = z.object({
  membershipId: uuid,
  identityId: uuid,
  email: z.string(),
  status: MemberStatusSchema,
  roles: z.array(z.string()),
  baseRole: z.string(),
  mfaEnabled: z.boolean(),
  createdAt: z.string(),
});
export type MemberSummary = z.infer<typeof MemberSummarySchema>;
export const MemberListResponseSchema = z.object({ members: z.array(MemberSummarySchema) });
export type MemberListResponse = z.infer<typeof MemberListResponseSchema>;

export const ProvisionMemberRequestSchema = z
  .object({
    email: IamEmailSchema,
    roles: z.array(IamRoleKeySchema).min(1).max(16),
    /** Envoie un lien de définition du mot de passe si l'identité n'a pas encore de mot de passe. */
    sendInvitation: z.boolean().default(true),
  })
  .strict();
export type ProvisionMemberRequest = z.infer<typeof ProvisionMemberRequestSchema>;

export const UpdateMemberRequestSchema = z
  .object({
    status: MemberStatusSchema.optional(),
    roles: z.array(IamRoleKeySchema).min(1).max(16).optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.roles !== undefined, { message: "Rien à modifier." });
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequestSchema>;

export const ImpersonationRequestSchema = z
  .object({
    tenantId: uuid,
    identityId: uuid,
    /** Motif obligatoire, conservé dans l'événement d'audit. */
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export type ImpersonationRequest = z.infer<typeof ImpersonationRequestSchema>;

export const ImpersonationResponseSchema = z.object({
  tokenType: z.literal("Bearer"),
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  sessionId: uuid,
  user: IamUserSummarySchema,
});
export type ImpersonationResponse = z.infer<typeof ImpersonationResponseSchema>;

// ---------------------------------------------------------------------------
// Événements publiés (outbox ; payload `{ v: 1, … }`). Aucun secret ni adresse e-mail en clair (sauf
// `iam.impersonation.started`, journal de sécurité de la plateforme). `userId` = alias de `identityId`
// (le module audit le lit) : `publish()` d'iam l'ajoute toujours.
// ---------------------------------------------------------------------------

const iamEvUuid = z.string().uuid();
const iamEvRequestMeta = { ip: z.string().nullable().optional(), userAgent: z.string().nullable().optional() };
const iamEv = <T extends z.ZodRawShape>(shape: T) => z.object({ v: z.literal(1), ...shape });
const iamIdentityEv = <T extends z.ZodRawShape>(shape: T) => iamEv({ identityId: iamEvUuid, userId: iamEvUuid, ...shape });

export const IamMembershipCreatedPayloadSchema = iamIdentityEv({
  membershipId: iamEvUuid,
  roles: z.array(z.string()),
  status: MemberStatusSchema,
});
export const IamMembershipChangedPayloadSchema = iamIdentityEv({
  membershipId: iamEvUuid,
  before: z.object({ status: MemberStatusSchema, roles: z.array(z.string()) }),
  after: z.object({ status: MemberStatusSchema, roles: z.array(z.string()) }),
  changedBy: iamEvUuid,
});

/** Schéma de charge utile de chaque événement PUBLIÉ par iam (validé par les tests de contrat). */
export const iamEventPayloadSchemas = {
  "iam.user.logged_in": iamIdentityEv({
    membershipId: iamEvUuid,
    sessionId: iamEvUuid,
    mfa: z.boolean(),
    amr: z.array(z.string()),
    method: z.string(),
    ...iamEvRequestMeta,
  }),
  "iam.login.failed": iamEv({
    reason: z.string(),
    identityId: iamEvUuid.nullable().optional(),
    userId: iamEvUuid.optional(),
    /** Empreinte de l'identifiant saisi (jamais l'adresse brute). */
    identifier: z.string().optional(),
    emailHash: z.string().optional(),
    locked: z.boolean(),
    ...iamEvRequestMeta,
  }),
  "iam.session.revoked": iamEv({
    identityId: iamEvUuid,
    userId: iamEvUuid,
    reason: z.string(),
    scope: z.enum(["one", "all", "family", "member"]),
    sessionId: iamEvUuid.optional(),
    sessionIds: z.array(iamEvUuid).optional(),
    revokedBy: iamEvUuid.nullable().optional(),
    ...iamEvRequestMeta,
  }),
  "iam.mfa.enabled": iamIdentityEv({ method: z.string(), via: z.string() }),
  "iam.mfa.disabled": iamIdentityEv({}),
  "iam.mfa.reset": iamIdentityEv({ membershipId: iamEvUuid, resetBy: iamEvUuid }),
  "iam.password.changed": iamIdentityEv({ via: z.string(), ip: z.string().nullable().optional() }),
  "iam.impersonation.started": iamEv({
    sessionId: iamEvUuid,
    superAdminId: iamEvUuid,
    actorType: z.literal("superAdmin"),
    targetUserId: iamEvUuid,
    actor: z.object({ id: iamEvUuid, email: z.string(), type: z.string() }),
    target: z.object({ identityId: iamEvUuid, membershipId: iamEvUuid, tenantId: iamEvUuid, activeRole: z.string() }),
    reason: z.string(),
    expiresAt: z.string(),
    ...iamEvRequestMeta,
  }),
  "iam.membership.created": IamMembershipCreatedPayloadSchema,
  "iam.membership.changed": IamMembershipChangedPayloadSchema,
} as const;
