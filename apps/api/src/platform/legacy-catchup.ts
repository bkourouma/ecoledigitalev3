/**
 * RATTRAPAGE des tenants legacy dans la plateforme v2.
 *
 * `tenant-sync` recopie `public.tenants` dans `kernel.tenants` (mêmes UUID) mais ne crée rien d'autre : un tenant
 * legacy n'a, côté v2, ni profil d'organisation, ni établissement, ni campus, ni onboarding, ni rôles système,
 * ni abonnement — donc aucun droit (`entitlements` : sans abonnement, uniquement CORE) et aucun rôle assignable.
 * Ce module comble l'écart, IDEMPOTENT (rejouable à chaque démarrage, sans doublon), pour chaque tenant non
 * archivé de `kernel.tenants` :
 *
 *   1. profil de l'organisation, UN établissement + son campus par défaut, état d'onboarding
 *      (`tenancy.ensureTenantFoundation`) ;
 *   2. rôles système (`rbac.instantiateSystemRoles`) ;
 *   3. abonnement — seulement s'il n'en existe aucun (`entitlements.setSubscription`).
 *
 * ┌─ HYPOTHÈSE DE PRODUIT, À VALIDER PAR LE PROPRIÉTAIRE DU PRODUIT ────────────────────────────────────────────┐
 * │ Les tenants legacy reçoivent par défaut le plan `V2_LEGACY_TENANT_DEFAULT_PLAN` (défaut PROFESSIONAL), le pack │
 * │ `V2_LEGACY_TENANT_DEFAULT_PACK` (défaut HIGHER : « l'application actuelle devient le socle SaaS et le pack    │
 * │ Higher », plan D1) et le pays `V2_LEGACY_TENANT_DEFAULT_COUNTRY` (défaut CI), avec un abonnement ACTIF sans   │
 * │ échéance. Rien n'est facturé (le socle mesure, il ne facture pas). Ni le plan, ni le pack, ni l'absence       │
 * │ d'échéance n'ont été arbitrés : à confirmer avant toute mise en production.                                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Les utilisateurs legacy ne sont PAS migrés vers `iam` ici (Phase 2 : import des comptes) : ils continuent de
 * s'authentifier avec le JWT legacy, qui donne un `request.ctx` mais aucune assignation RBAC (refus par défaut
 * sur les routes protégées par `requirePermission`).
 */
import { randomUUID } from "node:crypto";
import type { Logger } from "@ecoledigitale/kernel";
import { ensureTenantServices, listPlatformTenants, type PlatformDeps, type TenantServicesReport } from "../modules/platform";

export type CatchUpPack = "PRIMARY" | "SECONDARY" | "HIGHER" | "VIRTUAL";
const PACKS: readonly CatchUpPack[] = ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"];

export interface CatchUpPolicy {
  planKey: string;
  pack: CatchUpPack;
  countryCode: string;
}

export const DEFAULT_CATCHUP_POLICY: CatchUpPolicy = Object.freeze({ planKey: "PROFESSIONAL", pack: "HIGHER", countryCode: "CI" });

/** Lit la politique depuis l'environnement. Une valeur invalide REFUSE le démarrage (jamais de repli silencieux). */
export function readCatchUpPolicy(env: Readonly<Record<string, string | undefined>>): CatchUpPolicy {
  const planKey = (env.V2_LEGACY_TENANT_DEFAULT_PLAN?.trim() || DEFAULT_CATCHUP_POLICY.planKey).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(planKey)) {
    throw new Error(`V2_LEGACY_TENANT_DEFAULT_PLAN invalide : « ${planKey} » (majuscules, chiffres, _).`);
  }
  const pack = (env.V2_LEGACY_TENANT_DEFAULT_PACK?.trim() || DEFAULT_CATCHUP_POLICY.pack).toUpperCase();
  if (!(PACKS as readonly string[]).includes(pack)) {
    throw new Error(`V2_LEGACY_TENANT_DEFAULT_PACK invalide : « ${pack} » (attendu : ${PACKS.join(", ")}).`);
  }
  const countryCode = (env.V2_LEGACY_TENANT_DEFAULT_COUNTRY?.trim() || DEFAULT_CATCHUP_POLICY.countryCode).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error(`V2_LEGACY_TENANT_DEFAULT_COUNTRY invalide : « ${countryCode} » (code ISO à deux lettres).`);
  }
  return { planKey, pack: pack as CatchUpPack, countryCode };
}

export interface CatchUpReport {
  /** Tenants examinés (non archivés). */
  examined: number;
  /** Tenants pour lesquels au moins un élément a été créé. */
  changed: number;
  /** Tenants déjà complets : rien n'a été écrit. */
  alreadyComplete: number;
  created: { profiles: number; institutions: number; campuses: number; onboarding: number; roles: number; subscriptions: number };
  failed: Array<{ tenantId: string; error: string }>;
}

const emptyReport = (): CatchUpReport => ({
  examined: 0,
  changed: 0,
  alreadyComplete: 0,
  created: { profiles: 0, institutions: 0, campuses: 0, onboarding: 0, roles: 0, subscriptions: 0 },
  failed: [],
});

function tally(report: CatchUpReport, r: TenantServicesReport): void {
  const f = r.foundation;
  const profiles = f?.profileCreated ? 1 : 0;
  const institutions = f?.institutionCreated ? 1 : 0;
  const campuses = f?.campusCreated ? 1 : 0;
  const onboarding = f?.onboardingCreated ? 1 : 0;
  const subscriptions = r.subscriptionCreated ? 1 : 0;
  report.created.profiles += profiles;
  report.created.institutions += institutions;
  report.created.campuses += campuses;
  report.created.onboarding += onboarding;
  report.created.roles += r.rolesCreated;
  report.created.subscriptions += subscriptions;
  if (profiles + institutions + campuses + onboarding + subscriptions + r.rolesCreated > 0) report.changed += 1;
  else report.alreadyComplete += 1;
}

/** Rattrape UN tenant (appelé aussi à la création d'un tenant legacy, par le hook de `tenant-sync`). */
export async function catchUpTenant(deps: PlatformDeps, tenantId: string, policy: CatchUpPolicy): Promise<CatchUpReport> {
  const report = emptyReport();
  report.examined = 1;
  const meta = { requestId: `catchup-${randomUUID()}` };
  const result = await ensureTenantServices(deps, tenantId, {
    meta,
    foundation: { pack: policy.pack, countryCode: policy.countryCode },
    subscription: { planKey: policy.planKey, packs: [policy.pack], status: "ACTIVE", endsAt: null },
  });
  if (result.ok) tally(report, result.value);
  else report.failed.push({ tenantId, error: `${result.error.code}: ${result.error.message}` });
  return report;
}

/** Rattrape tous les tenants non archivés de `kernel.tenants`. Un tenant en échec n'arrête pas les autres. */
export async function catchUpLegacyTenants(
  deps: PlatformDeps,
  policy: CatchUpPolicy,
  logger: Pick<Logger, "info" | "warn" | "error">,
): Promise<CatchUpReport> {
  const total = emptyReport();
  const ids: string[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await listPlatformTenants(deps, { limit: 200, offset });
    if (!page.ok) throw page.error;
    ids.push(...page.value.items.filter((t) => t.status !== "archived").map((t) => t.id));
    if (offset + 200 >= page.value.total) break;
  }
  for (const tenantId of ids) {
    try {
      const one = await catchUpTenant(deps, tenantId, policy);
      total.examined += one.examined;
      total.changed += one.changed;
      total.alreadyComplete += one.alreadyComplete;
      for (const key of Object.keys(total.created) as Array<keyof CatchUpReport["created"]>) total.created[key] += one.created[key];
      total.failed.push(...one.failed);
    } catch (e) {
      total.examined += 1;
      total.failed.push({ tenantId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const f of total.failed) logger.error({ tenantId: f.tenantId, err: f.error }, "rattrapage v2 : échec pour un tenant");
  logger.info(
    { examined: total.examined, changed: total.changed, alreadyComplete: total.alreadyComplete, created: total.created, failed: total.failed.length, policy },
    "rattrapage des tenants legacy (v2) terminé",
  );
  return total;
}
