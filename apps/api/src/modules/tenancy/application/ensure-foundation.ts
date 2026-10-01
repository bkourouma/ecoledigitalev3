/**
 * Rattrapage d'un tenant EXISTANT (miroir `kernel.tenants` d'un tenant legacy) : crée, SANS rien dupliquer,
 * ce que le provisioning aurait créé — profil de l'organisation, un établissement + son campus par défaut,
 * l'état d'onboarding. Idempotent : le rejouer ne crée rien de plus et renvoie ce qui existait déjà.
 *
 * Différences avec `provisionTenant` : le tenant existe déjà (aucune écriture dans `kernel.tenants`), aucun
 * événement `tenancy.tenant.provisioned` n'est publié (le tenant n'est pas « nouveau » : pas d'essai
 * automatique, la politique d'abonnement est décidée par l'appelant), et les valeurs viennent d'une POLITIQUE
 * (pack et pays par défaut), pas d'un formulaire. Cette politique est une HYPOTHÈSE de produit à valider.
 */
import {
  NotFoundError,
  ValidationError,
  err,
  type AppError,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import { InstitutionPackSchema, type InstitutionPack } from "@ecoledigitale/contracts/src/v2/tenancy";
import { PROVISIONING_STEPS, initialSteps } from "../domain/onboarding";
import { uniqueCode } from "../domain/provisioning";
import { insertCampus, listCampuses } from "../infrastructure/campuses-repository";
import { findCountry } from "../infrastructure/countries-repository";
import { insertInstitution, listInstitutionCodes, listInstitutions } from "../infrastructure/institutions-repository";
import { hasSteps, saveSteps } from "../infrastructure/onboarding-repository";
import { getProfile, insertProfile } from "../infrastructure/profile-repository";
import { findTenant } from "../infrastructure/tenants-repository";
import { resolveDeps, runResult, type TenancyDeps } from "./support";

export interface EnsureFoundationInput {
  /** Pack de l'établissement créé s'il n'en existe aucun. */
  pack: InstitutionPack;
  /** Pays du profil et de l'établissement (défaut `CI`). */
  countryCode?: string;
}

export interface EnsureFoundationReport {
  tenantId: string;
  profileCreated: boolean;
  institutionCreated: boolean;
  campusCreated: boolean;
  onboardingCreated: boolean;
  /** `true` si RIEN n'a été créé (tout existait). */
  alreadyComplete: boolean;
}

export async function ensureTenantFoundation(
  deps: TenancyDeps,
  ctx: RequestContext,
  input: EnsureFoundationInput,
): Promise<Result<EnsureFoundationReport, AppError>> {
  const d = resolveDeps(deps);
  const pack = InstitutionPackSchema.safeParse(input.pack);
  if (!pack.success) {
    return err(ValidationError.field("pack", "Pack inconnu.", "tenancy.pack_unknown"));
  }
  const countryCode = (input.countryCode ?? "CI").toUpperCase();

  return runResult(d.db, ctx, async (tx) => {
    // Sérialise les rattrapages concurrents d'un même tenant (deux instances de l'API qui démarrent ensemble) :
    // sans ce verrou, les deux voyaient « pas de profil » et la seconde échouait sur la clé primaire.
    // Les requêtes suivantes lisent l'état validé par la première (instantané renouvelé à chaque énoncé).
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`tenancy.ensure_foundation:${ctx.tenantId}`]);
    const tenant = await findTenant(tx, ctx.tenantId);
    if (!tenant) throw NotFoundError.of("Organisation", ctx.tenantId, { code: "tenancy.tenant_not_found" });

    const now = d.clock.now();
    const country = await findCountry(tx, countryCode);
    if (!country) throw ValidationError.field("countryCode", `Pays inconnu : « ${countryCode} ».`, "tenancy.country_unknown");

    // 1. Profil de l'organisation.
    let profileCreated = false;
    if (!(await getProfile(tx, ctx.tenantId))) {
      await insertProfile(tx, { tenantId: ctx.tenantId, legalName: tenant.name, countryCode: country.code }, now);
      profileCreated = true;
    }

    // 2. Établissement(s) : un seul créé, seulement s'il n'en existe aucun.
    const institutions = await listInstitutions(tx);
    let institutionCreated = false;
    let campusCreated = false;
    if (institutions.length === 0) {
      const template = d.templates.get(pack.data);
      if (!template) throw ValidationError.field("pack", `Aucun modèle pour le pack « ${pack.data} ».`, "tenancy.pack_template_missing");
      const taken = await listInstitutionCodes(tx);
      const institutionId = d.newId();
      await insertInstitution(
        tx,
        {
          id: institutionId,
          tenantId: ctx.tenantId,
          code: uniqueCode(template.institution.code, taken),
          name: tenant.name,
          pack: pack.data,
          educationSystem: country.educationSystem,
          countryCode: country.code,
        },
        now,
      );
      await insertCampus(
        tx,
        {
          id: d.newId(),
          tenantId: ctx.tenantId,
          institutionId,
          code: template.defaultCampus.code,
          name: template.defaultCampus.name,
          isDefault: true,
        },
        now,
      );
      institutionCreated = true;
      campusCreated = true;
    } else {
      // Un établissement sans aucun campus (import partiel) reçoit son campus par défaut.
      for (const inst of institutions) {
        if ((await listCampuses(tx, inst.id)).length > 0) continue;
        const template = d.templates.get(inst.pack);
        await insertCampus(
          tx,
          {
            id: d.newId(),
            tenantId: ctx.tenantId,
            institutionId: inst.id,
            code: template?.defaultCampus.code ?? "main",
            name: template?.defaultCampus.name ?? "Campus principal",
            isDefault: true,
          },
          now,
        );
        campusCreated = true;
      }
    }

    // 3. Onboarding : les étapes que le provisioning accomplit sont terminées, les autres en attente.
    let onboardingCreated = false;
    if (!(await hasSteps(tx))) {
      const steps = initialSteps().map((s) =>
        PROVISIONING_STEPS.includes(s.key) ? { key: s.key, status: "COMPLETED" as const, completedAt: now } : s,
      );
      await saveSteps(tx, ctx.tenantId, steps, ctx.userId, now);
      onboardingCreated = true;
    }

    const created = profileCreated || institutionCreated || campusCreated || onboardingCreated;
    if (created) {
      await d.audit?.record(tx, {
        action: "tenancy.tenant.foundation_ensured",
        entity: "tenant",
        entityId: ctx.tenantId,
        after: { profileCreated, institutionCreated, campusCreated, onboardingCreated, pack: pack.data, countryCode: country.code },
        reason: "Rattrapage d'un tenant existant (politique par défaut)",
      });
    }
    return {
      tenantId: ctx.tenantId,
      profileCreated,
      institutionCreated,
      campusCreated,
      onboardingCreated,
      alreadyComplete: !created,
    };
  });
}
