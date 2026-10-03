/** Use cases « profil de l'organisation » et référentiel des pays. */
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type AppError,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import { isUniqueViolation } from "@ecoledigitale/database";
import { UpdateTenantProfileSchema } from "@ecoledigitale/contracts/src/v2/tenancy";
import type { CountryProfileRecord, TenantBrandingRecord, TenantProfileRecord } from "../domain/entities";
import { findCountry, listCountries as listCountryRows } from "../infrastructure/countries-repository";
import {
  getBranding,
  getProfile,
  updateProfile as updateProfileRow,
  type ProfilePatch,
} from "../infrastructure/profile-repository";
import { parseWith, resolveDeps, runResult, type TenancyDeps } from "./support";

const profileNotFound = (tenantId: string) =>
  NotFoundError.of("Profil de l'organisation", tenantId, { code: "tenancy.profile_not_found" });

export async function getTenantProfile(
  deps: TenancyDeps,
  ctx: RequestContext,
): Promise<Result<TenantProfileRecord, AppError>> {
  const d = resolveDeps(deps);
  return runResult(
    d.db,
    ctx,
    async (tx) => {
      const profile = await getProfile(tx, ctx.tenantId);
      if (!profile) throw profileNotFound(ctx.tenantId);
      return profile;
    },
    { readOnly: true },
  );
}

/**
 * Marque minimale du tenant de la session (RLS). Aucune permission nominative : ouvert à tout membre authentifié
 * (le contexte est exigé en amont par la route). Le tenant ciblé est TOUJOURS celui du contexte.
 */
export async function getTenantBranding(
  deps: TenancyDeps,
  ctx: RequestContext,
): Promise<Result<TenantBrandingRecord, AppError>> {
  const d = resolveDeps(deps);
  return runResult(
    d.db,
    ctx,
    async (tx) => {
      const branding = await getBranding(tx, ctx.tenantId);
      if (!branding) throw profileNotFound(ctx.tenantId);
      return branding;
    },
    { readOnly: true },
  );
}

export async function updateTenantProfile(
  deps: TenancyDeps,
  ctx: RequestContext,
  rawInput: unknown,
): Promise<Result<TenantProfileRecord, AppError>> {
  const d = resolveDeps(deps);
  const parsed = parseWith(UpdateTenantProfileSchema, rawInput);
  if (!parsed.ok) return parsed;
  const patch = parsed.value as ProfilePatch;

  return runResult(d.db, ctx, async (tx) => {
    const before = await getProfile(tx, ctx.tenantId);
    if (!before) throw profileNotFound(ctx.tenantId);

    if (patch.countryCode && !(await findCountry(tx, patch.countryCode))) {
      throw ValidationError.field("countryCode", `Pays inconnu : « ${patch.countryCode} ».`, "tenancy.country_unknown");
    }
    // `legalName` est obligatoire en base : on refuse `null` ici plutôt que de laisser fuiter une erreur SQL.
    if (patch.legalName === null) {
      throw ValidationError.field("legalName", "La raison sociale est obligatoire.", "tenancy.legal_name_required");
    }
    if (patch.countryCode === null) {
      throw ValidationError.field("countryCode", "Le pays est obligatoire.", "tenancy.country_required");
    }

    let after: TenantProfileRecord | null;
    try {
      after = await updateProfileRow(tx, ctx.tenantId, patch, d.clock.now());
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictError("Ce domaine personnalisé est déjà utilisé par une autre organisation.", {
          code: "tenancy.custom_domain_taken",
        });
      }
      throw e;
    }
    if (!after) throw profileNotFound(ctx.tenantId);

    await d.audit?.record(tx, {
      action: "tenancy.profile.update",
      entity: "tenant_profile",
      entityId: ctx.tenantId,
      before: { legalName: before.legalName, countryCode: before.countryCode, customDomain: before.customDomain },
      after: { legalName: after.legalName, countryCode: after.countryCode, customDomain: after.customDomain },
    });
    return after;
  });
}

export async function listCountries(
  deps: TenancyDeps,
  ctx: RequestContext,
): Promise<Result<CountryProfileRecord[], AppError>> {
  const d = resolveDeps(deps);
  return runResult(d.db, ctx, (tx) => listCountryRows(tx), { readOnly: true });
}
