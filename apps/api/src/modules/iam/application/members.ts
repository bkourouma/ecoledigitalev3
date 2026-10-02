/**
 * Membres d'un tenant : création/invitation, liste, modification.
 *
 * `provisionMember` est AUSSI l'API de provisioning utilisée par l'onboarding et
 * la migration depuis le legacy (avec un mot de passe initial ou un hash importé).
 *
 * Énumération : la réponse d'une invitation ne dit pas si l'identité existait déjà
 * (le résultat est le même). Seul un doublon DANS le tenant est signalé (409), ce
 * que l'administrateur du tenant sait déjà.
 */
import { ConflictError, ForbiddenError, ValidationError, err, newId, ok, type AppError, type Result, type RequestContext } from "@ecoledigitale/kernel";
import { AuthErrorCodes } from "@ecoledigitale/contracts/src/v2/iam";
import { hashOpaqueToken, randomSecret } from "../domain/tokens";
import { isPlausibleEmail, normalizeEmail } from "../domain/email";
import * as credentials from "../infrastructure/credential-repo";
import * as identities from "../infrastructure/identity-repo";
import * as memberships from "../infrastructure/membership-repo";
import * as sessions from "../infrastructure/session-repo";
import { IAM_EVENT, publish, type IamDeps, type RequestMeta } from "./deps";
import { passwordPolicyError } from "./password";
import type { AuthenticatedPrincipal } from "./ports";

const ROLE_RE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * SEC-07 : anti-escalade des rôles élevés. `membership.roles` est la source des droits (relue à chaque requête) : sans
 * garde, un directeur (`iam.user.manage`) se faisait un complice `owner` et contournait les exclusions de son modèle
 * (abonnement, rôles, paie propriétaire). `owner` ne s'accorde que depuis une session `owner` ; `admin` depuis owner/admin.
 */
const OWNER_ONLY_ROLES: readonly string[] = ["owner"];
const ADMIN_LEVEL_ROLES: readonly string[] = ["admin", "administrateur"];

export function canManageElevatedRoles(activeRole: string, roles: readonly string[]): boolean {
  const actor = String(activeRole ?? "").trim().toLowerCase();
  const wanted = roles.map((r) => String(r).trim().toLowerCase());
  if (wanted.some((r) => OWNER_ONLY_ROLES.includes(r)) && actor !== "owner") return false;
  if (wanted.some((r) => ADMIN_LEVEL_ROLES.includes(r)) && ![...OWNER_ONLY_ROLES, ...ADMIN_LEVEL_ROLES].includes(actor)) return false;
  return true;
}

export function assertCanGrantRoles(principal: Pick<AuthenticatedPrincipal, "activeRole">, roles: readonly string[]): Result<void, AppError> {
  return canManageElevatedRoles(principal.activeRole, roles)
    ? ok(undefined)
    : err(new ForbiddenError("Ce rôle ne peut être accordé que par un propriétaire ou un administrateur.", { code: AuthErrorCodes.forbidden }));
}

export interface ProvisionInput {
  email: string;
  roles: readonly string[];
  /** Mot de passe initial en clair (soumis à la politique). Exclusif avec `passwordHash`. */
  password?: string;
  /** Hash importé (bcrypt legacy ou scrypt) : re-haché de façon transparente au premier login. */
  passwordHash?: string;
  sendInvitation?: boolean;
  invitedBy?: string | null;
  meta: RequestMeta;
}

export interface ProvisionOutcome {
  membershipId: string;
  identityId: string;
}

/**
 * Crée (ou retrouve) l'identité globale par e-mail et ajoute son accès au tenant
 * du contexte. `ctx` doit être celui de l'acteur qui provisionne.
 */
export async function provisionMember(deps: IamDeps, ctx: RequestContext, input: ProvisionInput): Promise<Result<ProvisionOutcome, AppError>> {
  const email = normalizeEmail(input.email);
  if (!isPlausibleEmail(email)) return err(ValidationError.field("email", "Adresse e-mail invalide.", "invalid_email"));
  const roles = [...new Set(input.roles)];
  if (roles.length === 0 || roles.some((r) => !ROLE_RE.test(r))) return err(ValidationError.field("roles", "Rôles invalides.", "invalid_roles"));
  if (input.password !== undefined && input.passwordHash !== undefined) return err(ValidationError.field("password", "Mot de passe et hash sont exclusifs."));

  let passwordHash: string | null = input.passwordHash ?? null;
  if (input.password !== undefined) {
    const issues = deps.policy.evaluate(input.password, { email });
    if (issues.length > 0) return err(passwordPolicyError(issues));
    passwordHash = await deps.hasher.hash(input.password);
  }

  return deps.tenantDb.run(ctx, async (tx): Promise<Result<ProvisionOutcome, AppError>> => {
    const now = deps.clock.now();
    const tenant = await identities.findTenantById(tx, ctx.tenantId);
    if (!tenant || tenant.status !== "active") return err(new ForbiddenError("Établissement inactif.", { code: AuthErrorCodes.forbidden }));

    let identity = await identities.findIdentityByEmail(tx, email);
    if (!identity) {
      const created = await identities.insertIdentity(tx, { id: newId(), email, passwordHash, now });
      identity = await identities.findIdentityByEmail(tx, email); // relit aussi en cas de course (ON CONFLICT DO NOTHING)
      if (!created && !identity) return err(new ConflictError("Création impossible.", { code: "iam.conflict" }));
    }
    if (!identity) return err(new ConflictError("Création impossible.", { code: "iam.conflict" }));

    const membershipId = newId();
    const inserted = await memberships.insertMembership(tx, {
      id: membershipId,
      tenantId: ctx.tenantId,
      identityId: identity.id,
      status: "active",
      roles,
      invitedBy: input.invitedBy ?? ctx.userId,
      now,
    });
    if (!inserted) return err(new ConflictError("Cette personne a déjà un accès dans cet établissement.", { code: "iam.membership_exists" }));

    await publish(deps, tx, ctx, IAM_EVENT.membershipCreated, { identityId: identity.id, membershipId, roles, status: "active" }, { type: "membership", id: membershipId });

    // Pas de mot de passe défini (nouvelle identité sans mot de passe initial) : lien d'invitation.
    if ((input.sendInvitation ?? true) && !identity.password_hash && !passwordHash) {
      const token = randomSecret(32);
      const expiresAt = new Date(now.getTime() + deps.config.invitationTtlSec * 1000);
      await credentials.invalidateOpenResetTokens(tx, identity.id, now);
      await credentials.insertResetToken(tx, {
        id: newId(),
        identityId: identity.id,
        purpose: "invitation",
        tokenHash: hashOpaqueToken(deps.config.keys.tokenHash, token),
        now,
        expiresAt,
        ip: input.meta.ip,
      });
      const mail = { email: identity.email, token, expiresAt, tenantName: tenant.name };
      deps.background.run("iam.invitation-mail", () => deps.notifier.sendInvitation(mail));
    }
    return ok({ membershipId, identityId: identity.id });
  });
}

export async function listMembers(deps: IamDeps, principal: AuthenticatedPrincipal, page: { limit?: number; offset?: number } = {}): Promise<memberships.MemberListRow[]> {
  return deps.tenantDb.run(principal.ctx, (tx) => memberships.listMembers(tx, principal.ctx.tenantId, page.limit, page.offset), { readOnly: true });
}

/**
 * Modifie le statut et/ou les rôles d'un membre DU tenant. Interdit sur soi-même
 * (pas d'auto-élévation ni d'auto-verrouillage). Un statut non actif révoque les
 * sessions du membre dans ce tenant.
 */
export async function updateMember(
  deps: IamDeps,
  principal: AuthenticatedPrincipal,
  membershipId: string,
  patch: { status?: memberships.MembershipStatus | undefined; roles?: readonly string[] | undefined },
  meta: RequestMeta,
): Promise<Result<memberships.MembershipRow, AppError>> {
  if (principal.impersonatedBy) return err(new ForbiddenError("Action interdite pendant une impersonation.", { code: AuthErrorCodes.impersonationForbidden }));
  if (patch.roles && (patch.roles.length === 0 || patch.roles.some((r) => !ROLE_RE.test(r)))) {
    return err(ValidationError.field("roles", "Rôles invalides.", "invalid_roles"));
  }
  return deps.tenantDb.run(principal.ctx, async (tx): Promise<Result<memberships.MembershipRow, AppError>> => {
    const now = deps.clock.now();
    const tenantId = principal.ctx.tenantId;
    const current = await memberships.findMembershipById(tx, tenantId, membershipId);
    if (!current) return err(new ForbiddenError("Membre introuvable.", { code: AuthErrorCodes.forbidden }));
    if (current.identity_id === principal.identityId) return err(new ForbiddenError("Vous ne pouvez pas modifier votre propre accès.", { code: AuthErrorCodes.forbidden }));
    // Rôles accordés ET rôles actuels du membre ciblé (déclasser ou suspendre un propriétaire est aussi réservé).
    const elevated = assertCanGrantRoles(principal, [...(patch.roles ?? []), ...current.roles]);
    if (!elevated.ok) return elevated;

    const updated = await memberships.updateMembership(
      tx,
      tenantId,
      membershipId,
      { ...(patch.status ? { status: patch.status } : {}), ...(patch.roles ? { roles: [...new Set(patch.roles)] } : {}) },
      now,
    );
    if (!updated) return err(new ForbiddenError("Membre introuvable.", { code: AuthErrorCodes.forbidden }));

    // Statut non actif, ou rôles modifiés : les sessions existantes cessent d'être valides.
    // (Les rôles sont relus à chaque requête ; la révocation couvre en plus les jetons de rafraîchissement.)
    const deactivated = patch.status !== undefined && patch.status !== "active";
    if (deactivated) {
      const revoked = await sessions.revokeSessionsOfIdentity(tx, tenantId, current.identity_id, `membership_${patch.status}`, principal.identityId, now);
      if (revoked.length > 0) {
        await publish(deps, tx, principal.ctx, IAM_EVENT.sessionRevoked, { identityId: current.identity_id, reason: `membership_${patch.status}`, scope: "member", sessionIds: revoked.map((r) => r.id) }, { type: "membership", id: membershipId });
      }
    }
    await publish(
      deps,
      tx,
      principal.ctx,
      IAM_EVENT.membershipChanged,
      { identityId: current.identity_id, membershipId, before: { status: current.status, roles: current.roles }, after: { status: updated.status, roles: updated.roles }, changedBy: principal.identityId },
      { type: "membership", id: membershipId },
    );
    void meta;
    return ok(updated);
  });
}
