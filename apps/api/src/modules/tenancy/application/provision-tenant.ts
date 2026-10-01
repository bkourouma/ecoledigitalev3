/**
 * Provisioning d'une organisation (plan §4, phase 1, piste A, étape 3) :
 * remplace le clonage depuis un tenant de référence par une création pilotée
 * par les MODÈLES DE PACK (`templates/`).
 *
 * Tout se fait dans UNE transaction, sous l'identité du nouveau tenant (la RLS
 * s'applique donc dès la première ligne écrite) :
 *   1. kernel.tenants (l'organisation) ;
 *   2. tenancy.tenant_profiles ;
 *   3. une institution par pack choisi, chacune avec son campus par défaut ;
 *   4. l'onboarding (compte, établissement, pays, type, pack = terminés) ;
 *   5. événements outbox : `tenancy.institution.created` (un par établissement)
 *      puis `tenancy.tenant.provisioned`.
 * Au moindre échec, rien n'est créé.
 */
import {
  ConflictError,
  ValidationError,
  createRequestContext,
  createSystemContext,
  type AppError,
  type Result,
} from "@ecoledigitale/kernel";
import { isUniqueViolation } from "@ecoledigitale/database";
import {
  ProvisionTenantInputSchema,
  type ProvisionTenantResult,
} from "@ecoledigitale/contracts/src/v2/tenancy";
import { institutionCreatedEvent, tenantProvisionedEvent } from "../domain/events";
import { PROVISIONING_STEPS, computeOnboardingState, initialSteps, type StepRecord } from "../domain/onboarding";
import { planProvisioning } from "../domain/provisioning";
import { findCountry } from "../infrastructure/countries-repository";
import { publishEvents } from "../infrastructure/events";
import { insertCampus } from "../infrastructure/campuses-repository";
import { insertInstitution } from "../infrastructure/institutions-repository";
import { saveSteps } from "../infrastructure/onboarding-repository";
import { insertProfile } from "../infrastructure/profile-repository";
import { insertTenant } from "../infrastructure/tenants-repository";
import { parseWith, resolveDeps, runResult, type TenancyDeps } from "./support";

export interface ProvisionOptions {
  /** Opérateur plateforme à l'origine de la demande (audit) ; absent = acteur `system`. */
  requestedBy?: string;
  requestId?: string;
}

export async function provisionTenant(
  deps: TenancyDeps,
  rawInput: unknown,
  options: ProvisionOptions = {},
): Promise<Result<ProvisionTenantResult, AppError>> {
  const d = resolveDeps(deps);

  const parsed = parseWith(ProvisionTenantInputSchema, rawInput);
  if (!parsed.ok) return parsed;
  const input = parsed.value;

  const tenantId = d.newId();
  const ctx = options.requestedBy
    ? createRequestContext({
        tenantId,
        userId: options.requestedBy,
        actor: "superAdmin",
        ...(options.requestId ? { requestId: options.requestId } : {}),
      })
    : createSystemContext(tenantId, options.requestId);

  return runResult(d.db, ctx, async (tx) => {
    const country = await findCountry(tx, input.countryCode);
    if (!country) {
      throw ValidationError.field("countryCode", `Pays inconnu : « ${input.countryCode} ».`, "tenancy.country_unknown");
    }

    const planned = planProvisioning(input, tenantId, country, d.templates, d.newId);
    if (!planned.ok) throw planned.error;
    const plan = planned.value;

    const now = d.clock.now();

    try {
      await insertTenant(tx, { id: tenantId, slug: input.slug, name: input.name }, now);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictError(`Le slug « ${input.slug} » est déjà utilisé.`, { code: "tenancy.slug_taken" });
      }
      throw e;
    }

    await insertProfile(
      tx,
      {
        tenantId,
        legalName: input.name,
        countryCode: country.code,
        contactName: input.adminContact.name,
        contactEmail: input.adminContact.email,
        contactPhone: input.adminContact.phone ?? null,
      },
      now,
    );

    const events = [];
    for (const inst of plan.institutions) {
      await insertInstitution(
        tx,
        {
          id: inst.id,
          tenantId,
          code: inst.code,
          name: inst.name,
          pack: inst.pack,
          educationSystem: inst.educationSystem,
          countryCode: inst.countryCode,
        },
        now,
      );
      await insertCampus(
        tx,
        {
          id: inst.campus.id,
          tenantId,
          institutionId: inst.id,
          code: inst.campus.code,
          name: inst.campus.name,
          isDefault: true,
        },
        now,
      );
      events.push(
        institutionCreatedEvent(
          { ctx, clock: d.clock },
          {
            institutionId: inst.id,
            code: inst.code,
            name: inst.name,
            pack: inst.pack,
            countryCode: inst.countryCode,
            educationSystem: inst.educationSystem,
            defaultCampusId: inst.campus.id,
          },
        ),
      );
    }

    // Onboarding : ce que le provisioning accomplit lui-même est déjà terminé.
    const steps: StepRecord[] = initialSteps().map((s) =>
      PROVISIONING_STEPS.includes(s.key) ? { key: s.key, status: "COMPLETED", completedAt: now } : s,
    );
    await saveSteps(tx, tenantId, steps, options.requestedBy ?? null, now);

    events.push(
      tenantProvisionedEvent(
        { ctx, clock: d.clock },
        {
          tenantId,
          slug: input.slug,
          name: input.name,
          countryCode: country.code,
          packs: plan.institutions.map((i) => i.pack),
          institutionIds: plan.institutions.map((i) => i.id),
          adminContact: input.adminContact,
        },
      ),
    );
    await publishEvents(tx, events);

    await d.audit?.record(tx, {
      action: "tenancy.tenant.provision",
      entity: "tenant",
      entityId: tenantId,
      after: { slug: input.slug, packs: plan.institutions.map((i) => i.pack) },
    });

    return {
      tenantId,
      slug: input.slug,
      institutions: plan.institutions.map((i) => ({ id: i.id, code: i.code, pack: i.pack, defaultCampusId: i.campus.id })),
      onboarding: computeOnboardingState(steps),
    };
  });
}
