/**
 * Plugin Fastify du module `tenancy`.
 *
 *   await app.register(tenancyPlugin, {
 *     db,                                   // TenantDb (obligatoire)
 *     requirePermission,                    // garde du module rbac (sinon app.requirePermission, sinon REFUS)
 *     resolveContext,                       // RequestContext de la requête (défaut : request.requestContext)
 *   });
 *
 * Le plugin pose lui-même le préfixe `/api/v1/tenancy` : l'appelant NE DOIT PAS
 * en ajouter un. Toutes les routes passent par : garde de permission -> use case
 * -> repository ; aucune SQL ici.
 */
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { unwrap, type Clock } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import { EntityStatusSchema, OnboardingStepKeySchema } from "@ecoledigitale/contracts/src/v2/tenancy";
import {
  createCampus,
  deleteCampus,
  listCampuses,
  updateCampus,
} from "../application/campuses";
import { createInstitution, getInstitution, listInstitutions, updateInstitution } from "../application/institutions";
import {
  completeOnboardingStep,
  getOnboarding,
  skipOnboardingStep,
} from "../application/onboarding";
import { getTenantProfile, listCountries, updateTenantProfile } from "../application/profile";
import { parseWith, type AuditRecorder, type TenancyDeps } from "../application/support";
import {
  defaultContextResolver,
  installErrorHandler,
  resolvePermissionGuard,
  type ContextResolver,
  type PermissionGuardFactory,
} from "./common";
import {
  toCampusDto,
  toCountryDto,
  toInstitutionDto,
  toTenantProfileDto,
} from "./serializers";

export const TENANCY_ROUTE_PREFIX = "/api/v1/tenancy";

export interface TenancyPluginOptions {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditRecorder;
  requirePermission?: PermissionGuardFactory;
  resolveContext?: ContextResolver;
}

const IdParams = z.object({ id: z.string().uuid("Identifiant invalide.") });
const StepParams = z.object({ step: OnboardingStepKeySchema });
const InstitutionListQuery = z.object({ status: EntityStatusSchema.optional() }).strict();

const tenancyRoutes: FastifyPluginAsync<TenancyPluginOptions> = async (app: FastifyInstance, opts) => {
  if (!opts?.db) throw new Error("tenancy: l'option `db` (TenantDb) est obligatoire.");
  const deps: TenancyDeps = { db: opts.db, clock: opts.clock, audit: opts.audit };
  const guard = resolvePermissionGuard(app, opts.requirePermission);
  const ctxOf = opts.resolveContext ?? defaultContextResolver;

  installErrorHandler(app);

  const READ = guard("tenancy.institution.read");
  const MANAGE = guard("tenancy.institution.manage");
  const CAMPUS = guard("tenancy.campus.manage");

  // ---- Référentiel -----------------------------------------------------------
  app.get("/countries", { preHandler: READ }, async (req) => {
    const items = unwrap(await listCountries(deps, ctxOf(req)));
    return { items: items.map(toCountryDto) };
  });

  // ---- Profil de l'organisation ----------------------------------------------
  app.get("/profile", { preHandler: READ }, async (req) =>
    toTenantProfileDto(unwrap(await getTenantProfile(deps, ctxOf(req)))),
  );

  app.patch("/profile", { preHandler: MANAGE }, async (req) =>
    toTenantProfileDto(unwrap(await updateTenantProfile(deps, ctxOf(req), req.body))),
  );

  // ---- Établissements --------------------------------------------------------
  app.get("/institutions", { preHandler: READ }, async (req) => {
    const query = unwrap(parseWith(InstitutionListQuery, req.query ?? {}));
    const items = unwrap(await listInstitutions(deps, ctxOf(req), query));
    return { items: items.map(toInstitutionDto) };
  });

  app.get("/institutions/:id", { preHandler: READ }, async (req) => {
    const { id } = unwrap(parseWith(IdParams, req.params));
    return toInstitutionDto(unwrap(await getInstitution(deps, ctxOf(req), id)));
  });

  app.post("/institutions", { preHandler: MANAGE }, async (req, reply) => {
    const created = unwrap(await createInstitution(deps, ctxOf(req), req.body));
    return reply.status(201).send({
      ...toInstitutionDto(created.institution),
      defaultCampus: toCampusDto(created.defaultCampus),
    });
  });

  app.patch("/institutions/:id", { preHandler: MANAGE }, async (req) => {
    const { id } = unwrap(parseWith(IdParams, req.params));
    return toInstitutionDto(unwrap(await updateInstitution(deps, ctxOf(req), id, req.body)));
  });

  // ---- Campus ----------------------------------------------------------------
  app.get("/institutions/:id/campuses", { preHandler: READ }, async (req) => {
    const { id } = unwrap(parseWith(IdParams, req.params));
    const items = unwrap(await listCampuses(deps, ctxOf(req), id));
    return { items: items.map(toCampusDto) };
  });

  app.post("/institutions/:id/campuses", { preHandler: CAMPUS }, async (req, reply) => {
    const { id } = unwrap(parseWith(IdParams, req.params));
    const campus = unwrap(await createCampus(deps, ctxOf(req), id, req.body));
    return reply.status(201).send(toCampusDto(campus));
  });

  app.patch("/campuses/:id", { preHandler: CAMPUS }, async (req) => {
    const { id } = unwrap(parseWith(IdParams, req.params));
    return toCampusDto(unwrap(await updateCampus(deps, ctxOf(req), id, req.body)));
  });

  app.delete("/campuses/:id", { preHandler: CAMPUS }, async (req, reply) => {
    const { id } = unwrap(parseWith(IdParams, req.params));
    unwrap(await deleteCampus(deps, ctxOf(req), id));
    return reply.status(204).send();
  });

  // ---- Onboarding ------------------------------------------------------------
  app.get("/onboarding", { preHandler: READ }, async (req) => unwrap(await getOnboarding(deps, ctxOf(req))));

  app.post("/onboarding/steps/:step/complete", { preHandler: MANAGE }, async (req) => {
    const { step } = unwrap(parseWith(StepParams, req.params));
    return unwrap(await completeOnboardingStep(deps, ctxOf(req), step));
  });

  app.post("/onboarding/steps/:step/skip", { preHandler: MANAGE }, async (req) => {
    const { step } = unwrap(parseWith(StepParams, req.params));
    return unwrap(await skipOnboardingStep(deps, ctxOf(req), step));
  });
};

/**
 * Plugin du module. Les routes sont enregistrées sous `/api/v1/tenancy` dans un
 * contexte encapsulé (gestionnaire d'erreurs propre au module).
 */
export const tenancyPlugin: FastifyPluginAsync<TenancyPluginOptions> = async (app, opts) => {
  await app.register(tenancyRoutes, { ...opts, prefix: TENANCY_ROUTE_PREFIX } as TenancyPluginOptions & { prefix: string });
};

export default tenancyPlugin;
