/**
 * Use cases de la console plateforme : ORCHESTRATION de use cases existants (tenancy, rbac, entitlements, iam),
 * jamais de logique métier dupliquée ni de SQL. Chaque action réussie est tracée dans le journal d'audit de
 * PLATEFORME (`audit.recordPlatform`) ; les use cases appelés auditent en plus dans le journal du tenant visé.
 *
 *   provisionPlatformTenant   tenancy.provisionTenant -> rbac.instantiateSystemRoles -> abonnement d'essai
 *                             (entitlements.setSubscription) -> membre `owner` (iam.provisionMember) -> rôle
 *                             système `owner` (rbac.assignSystemRole) -> audit de plateforme
 *   ensureTenantServices      rattrapage idempotent d'un tenant existant (rôles + abonnement + fondation)
 *   changeTenantStatus        tenancy.setTenantStatus (suspension, réactivation, archivage)
 *   plans / abonnements / surcharges : entitlements.* + audit de plateforme
 *
 * Les étapes sont des transactions distinctes (un use case par module) : un échec en cours de provisioning
 * laisse un tenant PARTIEL, signalé par `platform.provisioning_partial` avec l'étape en cause ; `reconcile`
 * (idempotent) reprend les étapes de rôles et d'abonnement.
 */
import { PgOutboxWriter } from "@ecoledigitale/database";
import {
  ConflictError,
  createRequestContext,
  createSystemContext,
  isAppError,
  err,
  ok,
  type AppError,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import type { PlatformProvisionTenantBody, PlatformSetTenantStatusBody } from "@ecoledigitale/contracts/src/v2/platform";
import {
  getCatalog,
  getSubscription,
  listFeatureOverrides,
  removeFeatureOverride,
  setFeatureOverride,
  setPlanFeatures,
  setSubscription,
  upsertPlan,
  type EntitlementsDeps,
} from "../../entitlements";
import { assignSystemRoleUseCase, instantiateSystemRoles, rbacAuditAdapter } from "../../rbac";
import {
  ensureTenantFoundation,
  getTenantProfile,
  getTenantSummary,
  listInstitutions,
  listTenants,
  provisionTenant,
  setTenantStatus,
  type EnsureFoundationReport,
  type TenancyDeps,
  type TenantListFilter,
} from "../../tenancy";
import type { Operator, OperatorRequestMeta, PlatformAuditEntry, PlatformDeps, TrialPolicy } from "./deps";

// ---------------------------------------------------------------------------
// Contextes et dépendances dérivées
// ---------------------------------------------------------------------------

const operatorCtx = (tenantId: string, operator: Operator, meta: OperatorRequestMeta): RequestContext =>
  createRequestContext({ tenantId, userId: operator.id, actor: "superAdmin", requestId: meta.requestId });

const systemCtx = (tenantId: string, meta: OperatorRequestMeta): RequestContext => createSystemContext(tenantId, meta.requestId);

const tenancyDeps = (deps: PlatformDeps): TenancyDeps => ({
  db: deps.tenantDb,
  systemDb: deps.systemDb,
  clock: deps.clock,
  audit: deps.audit,
});

const entitlementsDeps = (deps: PlatformDeps): EntitlementsDeps => ({
  db: deps.tenantDb,
  systemDb: deps.systemDb,
  clock: deps.clock,
  audit: deps.audit,
  logger: deps.logger,
  ...(deps.entitlementsCache ? { cache: deps.entitlementsCache } : {}),
});

// ---------------------------------------------------------------------------
// Audit de plateforme
// ---------------------------------------------------------------------------

/**
 * Trace l'action de l'opérateur dans le journal de plateforme. `strict` : un échec d'audit est propagé (actions
 * sans audit de tenant correspondant, ex. plans). Sinon il est journalisé et l'action — déjà validée et déjà
 * auditée dans le journal du tenant — n'est pas présentée comme échouée (un rejeu du provisioning échouerait).
 */
async function auditPlatform(
  deps: PlatformDeps,
  operator: Operator,
  entry: PlatformAuditEntry,
  options: { strict?: boolean } = {},
): Promise<void> {
  try {
    await deps.systemDb.run("platform-console-audit", (tx) =>
      deps.audit.recordPlatform(tx, { severity: "notice", ...entry, actor: { type: "superAdmin", id: operator.id } }),
    );
  } catch (e) {
    deps.logger.error(
      { err: e instanceof Error ? e.message : String(e), action: entry.action, entityId: entry.entityId },
      "platform : journal d'audit de plateforme indisponible",
    );
    if (options.strict) throw e;
  }
}

// ---------------------------------------------------------------------------
// Rattrapage : rôles + abonnement + fondation
// ---------------------------------------------------------------------------

export interface TenantServicesReport {
  rolesCreated: number;
  rolesExisting: number;
  subscriptionCreated: boolean;
  foundation: EnsureFoundationReport | null;
}

export interface EnsureServicesOptions {
  meta: OperatorRequestMeta;
  /** Abonnement à poser SI le tenant n'en a aucun. */
  subscription: { planKey: string; packs: Array<"PRIMARY" | "SECONDARY" | "HIGHER" | "VIRTUAL">; status: "TRIALING" | "ACTIVE"; endsAt: Date | null };
  /** Crée profil / établissement / campus / onboarding manquants (tenants legacy). */
  foundation?: { pack: "PRIMARY" | "SECONDARY" | "HIGHER" | "VIRTUAL"; countryCode?: string };
  /** Acteur de l'abonnement créé (opérateur) ; défaut : `system`. */
  operator?: Operator;
}

/**
 * Idempotent : n'écrit que ce qui manque. Utilisé par le provisioning (étapes 2-3), le `reconcile` de la console
 * et le rattrapage des tenants legacy au démarrage (avec `foundation`).
 */
export async function ensureTenantServices(
  deps: PlatformDeps,
  tenantId: string,
  options: EnsureServicesOptions,
): Promise<Result<TenantServicesReport, AppError>> {
  const sys = systemCtx(tenantId, options.meta);
  const actorCtx = options.operator ? operatorCtx(tenantId, options.operator, options.meta) : sys;

  let foundation: EnsureFoundationReport | null = null;
  if (options.foundation) {
    const ensured = await ensureTenantFoundation(tenancyDeps(deps), sys, options.foundation);
    if (!ensured.ok) return ensured;
    foundation = ensured.value;
  }

  const roles = await deps.tenantDb.run(sys, (tx) => instantiateSystemRoles(tx, tenantId, { logger: deps.logger, clock: deps.clock }));

  const entDeps = entitlementsDeps(deps);
  const current = await getSubscription(entDeps, sys);
  if (!current.ok) return current;
  let subscriptionCreated = false;
  if (!current.value) {
    const created = await setSubscription(entDeps, actorCtx, {
      planKey: options.subscription.planKey,
      packs: options.subscription.packs,
      status: options.subscription.status,
      ...(options.subscription.endsAt ? { endsAt: options.subscription.endsAt.toISOString() } : {}),
    });
    if (!created.ok) return created;
    subscriptionCreated = true;
  }

  return ok({
    rolesCreated: roles.created.length,
    rolesExisting: roles.existing.length,
    subscriptionCreated,
    foundation,
  });
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

export interface ProvisionedTenant {
  tenantId: string;
  slug: string;
  institutions: Array<{ id: string; code: string; pack: string; defaultCampusId: string }>;
  owner: { identityId: string; membershipId: string; email: string };
  subscription: { planKey: string; status: "TRIALING"; endsAt: string | null };
}

const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000);

function partial(tenantId: string, step: string, cause: AppError): AppError {
  return new ConflictError("Provisionnement partiel : l'organisation existe mais une étape a échoué.", {
    code: "platform.provisioning_partial",
    details: { tenantId, step, cause: cause.code },
    cause,
  });
}

export async function provisionPlatformTenant(
  deps: PlatformDeps,
  operator: Operator,
  body: PlatformProvisionTenantBody,
  meta: OperatorRequestMeta,
): Promise<Result<ProvisionedTenant, AppError>> {
  // 1. L'organisation : kernel.tenants, profil, établissements + campus par défaut, onboarding, événements.
  const provisioned = await provisionTenant(
    tenancyDeps(deps),
    { name: body.name, slug: body.slug, countryCode: body.countryCode, packs: body.packs, adminContact: body.adminContact },
    { requestedBy: operator.id, requestId: meta.requestId },
  );
  if (!provisioned.ok) return provisioned;
  const tenant = provisioned.value;
  const tenantId = tenant.tenantId;
  const packs = [...new Set(body.packs)];
  const trial: TrialPolicy = { planKey: body.trial?.planKey ?? deps.trial.planKey, days: body.trial?.days ?? deps.trial.days };
  const endsAt = addDays(deps.clock.now(), trial.days);

  const fail = async (step: string, cause: AppError): Promise<Result<never, AppError>> => {
    await auditPlatform(deps, operator, {
      action: "platform.tenant.provisioning_failed",
      entity: "tenant",
      entityId: tenantId,
      severity: "warning",
      metadata: { step, code: cause.code, slug: tenant.slug },
    });
    return err(partial(tenantId, step, cause));
  };

  try {
    // 2-3. Rôles système + abonnement d'essai (idempotents).
    const services = await ensureTenantServices(deps, tenantId, {
      meta,
      operator,
      subscription: { planKey: trial.planKey, packs, status: "TRIALING", endsAt },
    });
    if (!services.ok) return await fail("services", services.error);

    // 4. Le fondateur : accès `owner` (invitation par e-mail, aucun mot de passe en clair) ...
    const ctx = operatorCtx(tenantId, operator, meta);
    const member = await deps.members.provisionMember(ctx, {
      email: body.adminContact.email,
      roles: ["owner"],
      sendInvitation: true,
      invitedBy: operator.id,
      meta: { ip: meta.ip ?? null, userAgent: meta.userAgent ?? null, requestId: meta.requestId },
    });
    if (!member.ok) return await fail("owner_membership", member.error);

    // 5. ... et rôle système `owner` du RBAC (acteur `system` : provisioning).
    const sys = systemCtx(tenantId, meta);
    const assigned = await deps.tenantDb.run(sys, (tx) =>
      assignSystemRoleUseCase(
        { tx, clock: deps.clock, outbox: new PgOutboxWriter(tx), audit: rbacAuditAdapter(deps.audit), logger: deps.logger },
        sys,
        { templateKey: "owner", userId: member.value.identityId, identityId: member.value.identityId },
      ),
    );
    if (!assigned.ok) return await fail("owner_role", assigned.error);

    await auditPlatform(deps, operator, {
      action: "platform.tenant.provisioned",
      entity: "tenant",
      entityId: tenantId,
      metadata: { slug: tenant.slug, packs, trialPlan: trial.planKey, trialDays: trial.days },
    });
    return ok({
      tenantId,
      slug: tenant.slug,
      institutions: tenant.institutions,
      owner: { identityId: member.value.identityId, membershipId: member.value.membershipId, email: body.adminContact.email },
      subscription: { planKey: trial.planKey, status: "TRIALING", endsAt: endsAt.toISOString() },
    });
  } catch (e) {
    if (isAppError(e)) return await fail("unexpected", e);
    throw e;
  }
}

/** Reprise idempotente des rôles et de l'abonnement d'un tenant (opérateur). */
export async function reconcileTenant(
  deps: PlatformDeps,
  operator: Operator,
  tenantId: string,
  meta: OperatorRequestMeta,
): Promise<Result<TenantServicesReport, AppError>> {
  const summary = await getTenantSummary(tenancyDeps(deps), tenantId);
  if (!summary.ok) return summary;
  // Packs de l'abonnement à poser s'il manque : ceux des établissements de l'organisation.
  const institutions = await listInstitutions(tenancyDeps(deps), systemCtx(tenantId, meta), {});
  if (!institutions.ok) return institutions;
  const packs = [...new Set(institutions.value.map((i) => i.pack))];
  const report = await ensureTenantServices(deps, tenantId, {
    meta,
    operator,
    subscription: { planKey: deps.trial.planKey, packs, status: "TRIALING", endsAt: addDays(deps.clock.now(), deps.trial.days) },
  });
  if (report.ok) {
    const { rolesCreated, rolesExisting, subscriptionCreated } = report.value;
    await auditPlatform(deps, operator, {
      action: "platform.tenant.reconciled",
      entity: "tenant",
      entityId: tenantId,
      metadata: { rolesCreated, rolesExisting, subscriptionCreated },
    });
  }
  return report;
}

// ---------------------------------------------------------------------------
// Consultation
// ---------------------------------------------------------------------------

export async function listPlatformTenants(deps: PlatformDeps, filter: TenantListFilter) {
  return listTenants(tenancyDeps(deps), filter);
}

export async function getTenantOverview(deps: PlatformDeps, tenantId: string, meta: OperatorRequestMeta) {
  const summary = await getTenantSummary(tenancyDeps(deps), tenantId);
  if (!summary.ok) return summary;
  const sys = systemCtx(tenantId, meta);
  const profile = await getTenantProfile(tenancyDeps(deps), sys);
  const institutions = await listInstitutions(tenancyDeps(deps), sys, {});
  const subscription = await getSubscription(entitlementsDeps(deps), sys);
  if (!institutions.ok) return institutions;
  if (!subscription.ok) return subscription;
  return ok({
    tenant: summary.value,
    profile: profile.ok ? profile.value : null,
    institutions: institutions.value,
    subscription: subscription.value,
  });
}

// ---------------------------------------------------------------------------
// Statut
// ---------------------------------------------------------------------------

export async function changeTenantStatus(
  deps: PlatformDeps,
  operator: Operator,
  tenantId: string,
  body: PlatformSetTenantStatusBody,
  meta: OperatorRequestMeta,
) {
  const changed = await setTenantStatus(tenancyDeps(deps), operatorCtx(tenantId, operator, meta), {
    status: body.status,
    ...(body.reason ? { reason: body.reason } : {}),
  });
  if (changed.ok) {
    deps.entitlementsCache?.invalidate(tenantId);
    await auditPlatform(deps, operator, {
      action: "platform.tenant.status_changed",
      entity: "tenant",
      entityId: tenantId,
      severity: body.status === "active" ? "notice" : "warning",
      reason: body.reason ?? null,
      metadata: { previous: changed.value.previous, current: changed.value.current },
    });
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Plans, abonnements, surcharges
// ---------------------------------------------------------------------------

export async function listPlatformCatalog(deps: PlatformDeps) {
  return getCatalog(entitlementsDeps(deps));
}

export async function upsertPlatformPlan(deps: PlatformDeps, operator: Operator, planKey: string, body: unknown) {
  const plan = await upsertPlan(entitlementsDeps(deps), planKey, body);
  if (plan.ok) {
    await auditPlatform(deps, operator, { action: "platform.plan.upserted", entity: "plan", entityId: planKey, metadata: { active: plan.value.active } }, { strict: true });
  }
  return plan;
}

export async function setPlatformPlanFeatures(deps: PlatformDeps, operator: Operator, planKey: string, body: unknown) {
  const plan = await setPlanFeatures(entitlementsDeps(deps), planKey, body);
  if (plan.ok) {
    await auditPlatform(
      deps,
      operator,
      { action: "platform.plan.features_set", entity: "plan", entityId: planKey, metadata: { featureCount: plan.value.featureKeys.length } },
      { strict: true },
    );
  }
  return plan;
}

export async function getTenantSubscription(deps: PlatformDeps, operator: Operator, tenantId: string, meta: OperatorRequestMeta) {
  return getSubscription(entitlementsDeps(deps), operatorCtx(tenantId, operator, meta));
}

export async function setTenantSubscription(deps: PlatformDeps, operator: Operator, tenantId: string, body: unknown, meta: OperatorRequestMeta) {
  const subscription = await setSubscription(entitlementsDeps(deps), operatorCtx(tenantId, operator, meta), body);
  if (subscription.ok) {
    await auditPlatform(deps, operator, {
      action: "platform.subscription.set",
      entity: "subscription",
      entityId: subscription.value.id,
      metadata: { tenantId, planKey: subscription.value.planKey, packs: subscription.value.packs, status: subscription.value.status },
    });
  }
  return subscription;
}

export async function listTenantOverrides(deps: PlatformDeps, operator: Operator, tenantId: string, meta: OperatorRequestMeta) {
  return listFeatureOverrides(entitlementsDeps(deps), operatorCtx(tenantId, operator, meta));
}

export async function setTenantOverride(
  deps: PlatformDeps,
  operator: Operator,
  tenantId: string,
  featureKey: string,
  body: unknown,
  meta: OperatorRequestMeta,
) {
  const override = await setFeatureOverride(entitlementsDeps(deps), operatorCtx(tenantId, operator, meta), featureKey, body);
  if (override.ok) {
    await auditPlatform(deps, operator, {
      action: "platform.override.set",
      entity: "feature_override",
      entityId: override.value.id,
      severity: "warning",
      reason: override.value.reason,
      metadata: { tenantId, featureKey, effect: override.value.effect },
    });
  }
  return override;
}

export async function removeTenantOverride(deps: PlatformDeps, operator: Operator, tenantId: string, featureKey: string, meta: OperatorRequestMeta) {
  const removed = await removeFeatureOverride(entitlementsDeps(deps), operatorCtx(tenantId, operator, meta), featureKey);
  if (removed.ok) {
    await auditPlatform(deps, operator, {
      action: "platform.override.removed",
      entity: "feature_override",
      entityId: featureKey,
      severity: "warning",
      metadata: { tenantId, featureKey },
    });
  }
  return removed;
}
