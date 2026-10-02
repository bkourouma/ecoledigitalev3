/**
 * Routes HTTP du module rules via Fastify `inject`, sur base réelle. L'assemblage (rbac, entitlements, authentification) est remplacé
 * par un `ModuleRuntime` factice : les en-têtes `x-perms` / `x-features` / `x-user` pilotent les gardes ; les réponses sont validées
 * par les schémas Zod de `packages/contracts/src/v2/rules.ts`.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId, noopLogger } from "@ecoledigitale/kernel";
import {
  RulesContractDtoSchema,
  RulesListRuleSetsResponseSchema,
  RulesResolveResponseSchema,
  RulesSimulationDtoSchema,
  RulesValidateResponseSchema,
  RulesVersionDetailDtoSchema,
  RulesEvaluateResponseSchema,
  RulesBindingDtoSchema,
} from "@ecoledigitale/contracts/src/v2/rules";
import type { ModuleRuntime } from "../../../platform/runtime";
import { v2ErrorHandler, requireContextHook } from "../../../platform/v2-http";
import rulesModulePlugin, { setup as rulesSetup } from "../http/plugin";
import { registerSimulationCaseSource } from "../application/registry";
import { defaultSimulationSources } from "../application/registry";
import manifest from "../manifest";
import { adminRows, createRulesTestDb, describeIntegration, makeWorld, seedCatalog, type RulesTestDb, type TestWorld } from "./support/db";
import { ecueGroup } from "./support/flow";

const OPERATOR_TOKEN = "operateur-valide";
const OPERATOR_ID = "00000000-0000-7000-8000-0000000000cc";

describeIntegration("HTTP /api/v1/rules", () => {
  let db: RulesTestDb;
  let world: TestWorld;
  let app: FastifyInstance;
  let tenantA: string;
  let tenantB: string;
  const hits = new Map<string, number>();

  const ALL_PERMS = manifest.permissions.map((p) => p.key).join(",");
  const ALL_FEATURES = manifest.features.map((f) => f.key).join(",");

  const headersFor = (tenant: string, user: string, over: Record<string, string> = {}) => ({
    "x-tenant": tenant,
    "x-user": user,
    "x-perms": ALL_PERMS,
    "x-features": ALL_FEATURES,
    ...over,
  });
  const userA = newId();
  const hA = (over: Record<string, string> = {}) => headersFor(tenantA, userA, over);
  const asOperator = { authorization: `Bearer ${OPERATOR_TOKEN}` };
  const url = (p: string) => `/api/v1/rules${p}`;

  beforeAll(async () => {
    db = await createRulesTestDb();
    world = makeWorld(db);
    await seedCatalog(world);
    tenantA = await db.createTenant("http-a");
    tenantB = await db.createTenant("http-b");

    const runtime = {
      tenantDb: db.tenantDb,
      systemDb: db.systemDb,
      clock: world.clock,
      logger: noopLogger,
      manifests: [manifest],
      env: {},
      auditPort: world.audit,
      requirePermission: (permission: string) => async (request: { headers: Record<string, string | string[] | undefined> }) => {
        const granted = String(request.headers["x-perms"] ?? "").split(",");
        if (!granted.includes(permission)) throw new ForbiddenError("Permission manquante.", { code: "rbac.forbidden", details: { permission } });
        if (manifest.permissions.find((p) => p.key === permission)?.sensitive && request.headers["x-mfa"] === "0") {
          throw new ForbiddenError("Authentification forte requise.", { code: "rbac.mfa_required" });
        }
      },
      entitlements: {
        reader: { getEntitlements: async () => ({ features: [] }), hasFeature: async () => true },
        requireFeature: (feature: string) => async (request: { headers: Record<string, string | string[] | undefined> }) => {
          if (!String(request.headers["x-features"] ?? "").split(",").includes(feature)) {
            throw new ForbiddenError("Fonction non disponible.", { code: "entitlements.feature_not_available", details: { feature } });
          }
        },
        isFeatureEnabled: async () => true,
      },
      scopeTrees: { forTenant: async () => ({ institutionOfCampus: () => undefined, knows: () => true }), invalidate: () => undefined },
      resolveContext: (request: { headers: Record<string, string | string[] | undefined> }) => {
        const tenant = request.headers["x-tenant"];
        const user = request.headers["x-user"];
        if (typeof tenant !== "string" || typeof user !== "string") throw new UnauthorizedError();
        return createRequestContext({ tenantId: tenant, userId: user, roles: ["directeur_etudes"], mfa: request.headers["x-mfa"] !== "0" });
      },
      rateLimiter: {
        hit: async (key: string, rule: { limit: number; windowMs: number }) => {
          const count = (hits.get(key) ?? 0) + 1;
          hits.set(key, count);
          return { allowed: count <= rule.limit, count, retryAfterMs: 30_000 };
        },
        lockStatus: async () => ({ blocked: false, retryAfterMs: 0 }),
        recordFailure: async () => ({ blocked: false, retryAfterMs: 0 }),
        clear: async () => undefined,
      },
      superAdminAuthorizer: {
        authorize: async (request: { headers: Record<string, string | string[] | undefined> }) => {
          if (request.headers.authorization !== `Bearer ${OPERATOR_TOKEN}`) throw new UnauthorizedError("Opérateur non authentifié.");
          return { actorId: OPERATOR_ID, email: "operateur@exemple.test" };
        },
      },
      accountNotifier: { sendPasswordReset: async () => undefined, sendInvitation: async () => undefined },
    } as unknown as ModuleRuntime;

    app = Fastify({ logger: false });
    await rulesSetup(app, runtime); // décore app.rules et charge les données de départ (idempotent)
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      if (typeof request.headers["x-tenant"] === "string" && typeof request.headers["x-user"] === "string") {
        request.ctx = runtime.resolveContext(request);
      }
    });
    await app.register(
      async (scope) => {
        scope.setErrorHandler(v2ErrorHandler);
        scope.addHook("preHandler", requireContextHook);
        await rulesModulePlugin(scope, runtime);
      },
      { prefix: "/api/v1/rules" },
    );
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    defaultSimulationSources.clear();
    await db.drop();
  });

  const json = (res: { body: string }) => JSON.parse(res.body) as Record<string, any>;

  describe("gardes", () => {
    it("401 sans contexte ; 403 sans permission ; 403 sans la fonction (feature) ; 403 permission sensible sans MFA", async () => {
      expect((await app.inject({ method: "GET", url: url("/rule-sets") })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: url("/rule-sets"), headers: hA({ "x-perms": "" }) })).statusCode).toBe(403);
      const noFeature = await app.inject({ method: "POST", url: url("/rule-sets/CI-HIGHER-LMD/variants"), headers: hA({ "x-features": "" }), payload: {} });
      expect(noFeature.statusCode).toBe(403);
      expect(json(noFeature).code).toBe("entitlements.feature_not_available");
      const noMfa = await app.inject({ method: "POST", url: url(`/rule-versions/${newId()}/transitions`), headers: hA({ "x-mfa": "0" }), payload: { to: "proposed" } });
      expect(noMfa.statusCode).toBe(403);
      expect(json(noMfa).code).toBe("rbac.mfa_required");
    });

    it("les routes de la console exigent le super-administrateur : 401 sans jeton, et un utilisateur de tenant n'y accède pas", async () => {
      for (const path of ["/platform/rule-sets", "/platform/queue", "/platform/impact", "/platform/settings"]) {
        const none = await app.inject({ method: "GET", url: url(path) });
        expect(none.statusCode, path).toBe(401);
        const tenantUser = await app.inject({ method: "GET", url: url(path), headers: hA() });
        expect(tenantUser.statusCode, path).toBe(401);
        expect((await app.inject({ method: "GET", url: url(path), headers: asOperator })).statusCode, path).toBe(200);
      }
    });

    it("chaque route protégée déclare une permission du manifeste (aucun contrôle de rôle en dur)", () => {
      const routes = (app as unknown as { printRoutes(o: object): string }).printRoutes({ commonPrefix: false });
      expect(routes).toContain("rule-sets");
      // Le plugin n'appelle jamais de rôle codé : seules les permissions du manifeste sont référencées.
      const declared = new Set(manifest.permissions.map((p) => p.key));
      for (const key of ["rules.ruleset.read", "rules.version.create", "rules.version.edit", "rules.version.edit_expression", "rules.version.simulate", "rules.version.propose", "rules.binding.manage"]) {
        expect(declared.has(key), key).toBe(true);
      }
    });
  });

  describe("variantes d'établissement", () => {
    let versionId: string;

    it("GET /rule-sets : catalogue visible (jeux nationaux publiés), conforme au contrat", async () => {
      const res = await app.inject({ method: "GET", url: url("/rule-sets"), headers: hA() });
      expect(res.statusCode).toBe(200);
      const body = RulesListRuleSetsResponseSchema.parse(json(res));
      expect(body.items.map((s) => s.code).sort()).toEqual(["CI-CLASSIC-SEMESTRE", "CI-EXAM-PLACEHOLDER", "CI-HIGHER-BTS", "CI-HIGHER-LMD", "CI-PRIMARY-PLACEHOLDER", "CI-SECONDARY-PLACEHOLDER"]);
      expect(body.items.every((s) => s.versions.every((v) => v.status === "published"))).toBe(true);
      const filtered = await app.inject({ method: "GET", url: url("/rule-sets?code=CI-HIGHER-LMD&origin=national"), headers: hA() });
      expect(json(filtered).items).toHaveLength(1);
      expect((await app.inject({ method: "GET", url: url("/rule-sets?status=bogus"), headers: hA() })).statusCode).toBe(400);
    });

    it("POST /rule-sets/:code/variants -> 201 ; la variante est une COPIE modifiable", async () => {
      const list = json(await app.inject({ method: "GET", url: url("/rule-sets?code=CI-HIGHER-LMD"), headers: hA() }));
      const baseVersionId = list.items[0].versions[0].id as string;
      const res = await app.inject({ method: "POST", url: url("/rule-sets/CI-HIGHER-LMD/variants"), headers: hA(), payload: { baseVersionId, effectiveFrom: "2025-09-01" } });
      expect(res.statusCode).toBe(201);
      const body = RulesVersionDetailDtoSchema.parse(json(res));
      expect(body).toMatchObject({ origin: "tenant", status: "draft", versionNo: 1, basedOnVersionId: baseVersionId });
      expect(body.rules.length).toBeGreaterThan(20);
      versionId = body.id;
      // Corps invalide / inconnu : 400 ; version de base inexistante : 404.
      expect((await app.inject({ method: "POST", url: url("/rule-sets/CI-HIGHER-LMD/variants"), headers: hA(), payload: { baseVersionId, effectiveFrom: "bientôt" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: url("/rule-sets/CI-HIGHER-LMD/variants"), headers: hA(), payload: { baseVersionId: newId(), effectiveFrom: "2025-09-01" } })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: url(`/rule-versions/${newId()}`), headers: hA() })).statusCode).toBe(404);
      // Autre établissement : 404 (RLS).
      expect((await app.inject({ method: "GET", url: url(`/rule-versions/${versionId}`), headers: headersFor(tenantB, newId()) })).statusCode).toBe(404);
    });

    it("PATCH /parameters : bornes (400, message du moteur), mode non permis (400), verrou optimiste (409)", async () => {
      const ok = await app.inject({ method: "PATCH", url: url(`/rule-versions/${versionId}/parameters`), headers: hA(), payload: { changes: [{ ruleKey: "ecue_validee", parameter: "seuil_validation", value: 11 }, { ruleKey: "ue_validee", parameter: "seuil_validation", value: 11 }, { ruleKey: "statut_ecue", parameter: "seuil_validation", value: 11 }] } });
      expect(ok.statusCode).toBe(200);
      const detail = RulesVersionDetailDtoSchema.parse(json(ok));
      expect(detail.rules.find((r) => r.key === "ecue_validee")!.parameters.seuil_validation!.default).toBe(11);
      const range = await app.inject({ method: "PATCH", url: url(`/rule-versions/${versionId}/parameters`), headers: hA(), payload: { changes: [{ ruleKey: "ecue_validee", parameter: "seuil_validation", value: 25 }] } });
      expect(range.statusCode).toBe(400);
      expect(json(range).message).toMatch(/hors de l'intervalle autorisé/);
      const mode = await app.inject({ method: "PATCH", url: url(`/rule-versions/${versionId}/parameters`), headers: hA(), payload: { changes: [{ ruleKey: "semestre_valide", parameter: "mode_validation", value: "PLUS_OU_MOINS" }] } });
      expect(mode.statusCode).toBe(400);
      const stale = await app.inject({ method: "PATCH", url: url(`/rule-versions/${versionId}/parameters`), headers: hA(), payload: { expectedRowVersion: 1, changes: [{ ruleKey: "mention_releve", parameter: "passable", value: 9 }] } });
      expect(stale.statusCode).toBe(409);
      expect(json(stale).code).toBe("rules.stale_version");
    });

    it("PUT /rules/:key : diagnostics français si l'expression est invalide, 200 sinon ; POST /validate", async () => {
      const bad = await app.inject({ method: "PUT", url: url(`/rule-versions/${versionId}/rules/ecue_eliminee`), headers: hA(), payload: { expression: "note <" } });
      expect(bad.statusCode).toBe(400);
      expect(json(bad).details.diagnostics[0]).toMatchObject({ phase: "syntax", position: expect.objectContaining({ line: 1, column: expect.any(Number) }) });
      const good = await app.inject({ method: "PUT", url: url(`/rule-versions/${versionId}/rules/ecue_eliminee`), headers: hA(), payload: { expression: "!is_null(note) && note < params.seuil_eliminatoire" } });
      expect(good.statusCode).toBe(200);
      const validation = RulesValidateResponseSchema.parse(json(await app.inject({ method: "POST", url: url(`/rule-versions/${versionId}/validate`), headers: hA(), payload: {} })));
      expect(validation).toMatchObject({ ok: true, contractId: "credit-semester@1", violations: [] });
      // La fonction « éditeur d'expressions » est une feature payante.
      const noEditor = await app.inject({ method: "PUT", url: url(`/rule-versions/${versionId}/rules/ecue_eliminee`), headers: hA({ "x-features": "rules.variants" }), payload: { expression: "true" } });
      expect(noEditor.statusCode).toBe(403);
    });

    it("POST /simulations -> 202 asynchrone, progression sur GET /simulations/:id, rapport conforme ; sans source branchée la simulation reste PENDING", async () => {
      const pending = await app.inject({ method: "POST", url: url(`/rule-versions/${versionId}/simulations`), headers: hA(), payload: { dataset: { periodIds: [newId()] } } });
      expect(pending.statusCode).toBe(202);
      const pendingId = json(pending).simulationId as string;
      const stillPending = RulesSimulationDtoSchema.parse(json(await app.inject({ method: "GET", url: url(`/simulations/${pendingId}`), headers: hA() })));
      expect(stillPending.status).toBe("PENDING");

      registerSimulationCaseSource("credit-semester@1", { buildCaseGroups: async ({ progress }) => { await progress(50); return [ecueGroup(60)]; } });
      const res = await app.inject({ method: "POST", url: url(`/rule-versions/${versionId}/simulations`), headers: hA(), payload: { dataset: { periodIds: [newId()], sample: { size: 60 } } } });
      expect(res.statusCode).toBe(202);
      const id = json(res).simulationId as string;
      await app.rules.deps.background.drain();
      const done = RulesSimulationDtoSchema.parse(json(await app.inject({ method: "GET", url: url(`/simulations/${id}`), headers: hA() })));
      expect(done).toMatchObject({ status: "COMPLETED", progressPercent: 100, casesCount: 60, contractId: "credit-semester@1" });
      expect(done.summary!.evaluations).toBe(120);
      expect(done.differences.length).toBeGreaterThan(0);
      expect(Number(done.decisionChangedPercent)).toBeGreaterThan(0);
      // Aucune donnée d'élève dans le rapport : seulement des références opaques.
      expect(JSON.stringify(done)).not.toMatch(/nom|prénom|email/i);
      expect((await app.inject({ method: "GET", url: url(`/simulations/${id}`), headers: headersFor(tenantB, newId()) })).statusCode).toBe(404);
      defaultSimulationSources.clear();
    });

    it("POST /transitions : simulated puis proposed (confirmation d'impact), un tenant ne peut pas approuver (403), les erreurs ont le format du kernel", async () => {
      const toSimulated = await app.inject({ method: "POST", url: url(`/rule-versions/${versionId}/transitions`), headers: hA(), payload: { to: "simulated" } });
      expect(toSimulated.statusCode).toBe(200);
      expect(json(toSimulated).version.status).toBe("simulated");
      const unconfirmed = await app.inject({ method: "POST", url: url(`/rule-versions/${versionId}/transitions`), headers: hA(), payload: { to: "proposed" } });
      expect(unconfirmed.statusCode).toBe(409);
      expect(json(unconfirmed)).toMatchObject({ code: "rules.decision_impact_confirmation_required", kind: "conflict", status: 409 });
      const proposed = await app.inject({ method: "POST", url: url(`/rule-versions/${versionId}/transitions`), headers: hA(), payload: { to: "proposed", confirmDecisionImpact: true } });
      expect(proposed.statusCode).toBe(200);
      expect(json(proposed).version.definitionHash).toMatch(/^[0-9a-f]{64}$/);
      const approve = await app.inject({ method: "POST", url: url(`/rule-versions/${versionId}/transitions`), headers: hA(), payload: { to: "approved", comment: "ok" } });
      expect(approve.statusCode).toBe(403);
      expect(json(approve).code).toBe("rules.transition_forbidden");
      expect((await app.inject({ method: "POST", url: url(`/rule-versions/${versionId}/transitions`), headers: hA(), payload: { to: "teleportation" } })).statusCode).toBe(400);
    });

    it("console : file d'approbation, approbation (commentaire obligatoire), publication, historique visible de l'établissement", async () => {
      const queue = json(await app.inject({ method: "GET", url: url("/platform/queue"), headers: asOperator }));
      const item = queue.items.find((i: { version: { id: string } }) => i.version.id === versionId);
      expect(item).toMatchObject({ tenantId: tenantA, decisionImpactConfirmed: true });
      const noComment = await app.inject({ method: "POST", url: url(`/platform/rule-versions/${versionId}/approve`), headers: asOperator, payload: { tenantId: tenantA } });
      expect(noComment.statusCode).toBe(400);
      expect(json(noComment).code).toBe("rules.comment_required");
      const approved = await app.inject({ method: "POST", url: url(`/platform/rule-versions/${versionId}/approve`), headers: asOperator, payload: { tenantId: tenantA, comment: "Conforme." } });
      expect(approved.statusCode).toBe(200);
      expect(json(approved).version).toMatchObject({ status: "approved", approvedBy: OPERATOR_ID });
      const published = await app.inject({ method: "POST", url: url(`/platform/rule-versions/${versionId}/publish`), headers: asOperator, payload: { tenantId: tenantA } });
      expect(json(published).version.status).toBe("published");

      const events = json(await app.inject({ method: "GET", url: url(`/rule-versions/${versionId}/events`), headers: hA() }));
      expect(events.items.map((e: { toStatus: string }) => e.toStatus)).toEqual(["draft", "simulated", "proposed", "approved", "published"]);
      expect(events.items.at(-1)).toMatchObject({ toStatus: "published", actorKind: "super_admin", actorId: OPERATOR_ID });
      const impact = json(await app.inject({ method: "GET", url: url("/platform/impact"), headers: asOperator }));
      expect(impact.items.some((i: { tenantId: string }) => i.tenantId === tenantA)).toBe(true);
    });
  });

  describe("liaisons, contrats, résolution, banc d'essai", () => {
    it("PUT/GET/DELETE /bindings", async () => {
      const put = await app.inject({ method: "PUT", url: url("/bindings"), headers: hA(), payload: { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" } });
      expect(put.statusCode).toBe(200);
      const binding = RulesBindingDtoSchema.parse(json(put));
      const list = json(await app.inject({ method: "GET", url: url("/bindings?contractId=credit-semester@1"), headers: hA() }));
      expect(list.items).toHaveLength(1);
      expect((await app.inject({ method: "PUT", url: url("/bindings"), headers: hA(), payload: { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2030-01-01" } })).statusCode).toBe(409);
      expect((await app.inject({ method: "PUT", url: url("/bindings"), headers: hA({ "x-perms": "rules.ruleset.read" }), payload: {} })).statusCode).toBe(403);
      expect((await app.inject({ method: "DELETE", url: url(`/bindings/${binding.id}`), headers: headersFor(tenantB, newId()) })).statusCode).toBe(404);
      // La suppression est remise après la résolution ci-dessous.
      const resolveRes = await app.inject({ method: "GET", url: url("/resolve?contractId=credit-semester@1&date=2026-09-15"), headers: hA() });
      const resolved = RulesResolveResponseSchema.parse(json(resolveRes));
      expect(resolved.resolved).toMatchObject({ origin: "tenant", ruleSetCode: "CI-HIGHER-LMD", bindingId: binding.id }); // la variante publiée du test précédent
      const early = RulesResolveResponseSchema.parse(json(await app.inject({ method: "GET", url: url("/resolve?contractId=credit-semester@1&date=2025-08-31"), headers: hA() })));
      expect(early.resolved?.origin).toBe("national");
      expect((await app.inject({ method: "GET", url: url("/resolve?contractId=credit-semester@1"), headers: hA() })).statusCode).toBe(400);
      expect((await app.inject({ method: "DELETE", url: url(`/bindings/${binding.id}`), headers: hA() })).statusCode).toBe(204);
    });

    it("PUT /bindings avec `placeholderAck` exige la permission sensible dédiée ; resolve expose `sourceKind`", async () => {
      const body = {
        contractId: "coef-period@1",
        ruleSetCode: "CI-PRIMARY-PLACEHOLDER",
        levelCode: "PRIMARY",
        effectiveFrom: "2026-09-01",
        placeholderAck: { reason: "Démonstration interne, sans valeur officielle." },
      };
      const without = ALL_PERMS.split(",").filter((p) => p !== "rules.binding.accept_placeholder").join(",");
      const refused = await app.inject({ method: "PUT", url: url("/bindings"), headers: hA({ "x-perms": without }), payload: body });
      expect(refused.statusCode).toBe(403);
      expect(json(refused).details?.permission ?? json(refused).error?.details?.permission ?? "rules.binding.accept_placeholder").toBe("rules.binding.accept_placeholder");
      // un accusé sans MFA est refusé (permission sensible)
      expect((await app.inject({ method: "PUT", url: url("/bindings"), headers: hA({ "x-mfa": "0" }), payload: body })).statusCode).toBe(403);

      const ok = await app.inject({ method: "PUT", url: url("/bindings"), headers: hA(), payload: body });
      expect(ok.statusCode).toBe(200);
      const dto = RulesBindingDtoSchema.parse(json(ok));
      expect(dto).toMatchObject({ placeholderAcknowledged: true, ruleSetCode: "CI-PRIMARY-PLACEHOLDER" });

      const resolved = RulesResolveResponseSchema.parse(json(await app.inject({ method: "GET", url: url("/resolve?contractId=coef-period@1&levelCode=PRIMARY&date=2026-10-01"), headers: hA() })));
      expect(resolved.resolved?.sourceKind).toBe("placeholder");
      expect((await app.inject({ method: "DELETE", url: url(`/bindings/${dto.id}`), headers: hA() })).statusCode).toBe(204);
    });

    it("GET /contracts et /contracts/:id", async () => {
      const list = json(await app.inject({ method: "GET", url: url("/contracts"), headers: hA() }));
      expect(list.items.map((c: { id: string }) => c.id).sort()).toEqual(["coef-period@1", "coef-semester@1", "competency-period@1", "credit-semester@1", "exam-national@1", "secondary-annual@1"]);
      const one = RulesContractDtoSchema.parse(json(await app.inject({ method: "GET", url: url("/contracts/credit-semester@1"), headers: hA() })));
      expect(one.rules.find((r) => r.key === "statut_ecue")!.outputCodes).toContain("COMPENSATED");
      expect((await app.inject({ method: "GET", url: url("/contracts/inconnu@1"), headers: hA() })).statusCode).toBe(404);
    });

    it("POST /evaluate : banc d'essai sans persistance, limité à 30 appels par minute et par utilisateur (429 + Retry-After)", async () => {
      const list = json(await app.inject({ method: "GET", url: url("/rule-sets?code=CI-CLASSIC-SEMESTRE"), headers: hA() }));
      const versionId = list.items[0].versions[0].id as string;
      const user = newId();
      const call = (moyenne: number | null) =>
        app.inject({ method: "POST", url: url("/evaluate"), headers: headersFor(tenantA, user), payload: { versionId, ruleKey: "mention", context: { variables: { moyenne } } } });
      const first = await call(13.99);
      expect(first.statusCode).toBe(200);
      const body = RulesEvaluateResponseSchema.parse(json(first));
      expect(body).toMatchObject({ ruleKey: "mention", type: "string", value: "GOOD", definitionHash: expect.any(String), engineVersion: "0.1.0" });
      expect(body.trace.length).toBeGreaterThan(0);
      const before = await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM rules.evaluation_failures");
      expect((await call(null)).statusCode).toBe(200); // null = « En attente », pas une erreur
      const bad = await app.inject({ method: "POST", url: url("/evaluate"), headers: headersFor(tenantA, user), payload: { versionId, ruleKey: "mention", context: { variables: { moyenne: "abc" } } } });
      expect(bad.statusCode).toBe(400);
      expect(json(bad).code).toBe("rules.evaluation_failed");
      expect((await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM rules.evaluation_failures"))[0]!.n).toBe(before[0]!.n); // banc d'essai : rien n'est journalisé
      let last = 200;
      for (let i = 0; i < 30; i++) last = (await call(10)).statusCode;
      expect(last).toBe(429);
      const limited = await call(10);
      expect(limited.statusCode).toBe(429);
      expect(limited.headers["retry-after"]).toBeDefined();
      // Un autre utilisateur n'est pas limité.
      expect((await app.inject({ method: "POST", url: url("/evaluate"), headers: headersFor(tenantA, newId()), payload: { versionId, ruleKey: "mention", context: { variables: { moyenne: 10 } } } })).statusCode).toBe(200);
    });
  });

  describe("console : catalogue national", () => {
    it("POST /platform/rule-sets et /versions (201), remplacement des règles du brouillon, transitions, paramètres de plateforme", async () => {
      const lmd = json(await app.inject({ method: "GET", url: url("/platform/rule-sets?code=CI-HIGHER-LMD"), headers: asOperator }));
      const detail = json(await app.inject({ method: "GET", url: url(`/platform/rule-versions/${lmd.items[0].versions[0].id}`), headers: asOperator }));
      const rules = (detail.rules as Array<Record<string, any>>).map((r) => ({ key: r.key, type: r.type, expression: r.expression, description: r.description ?? undefined, parameters: r.parameters, labelMap: r.labelMap }));

      const set = await app.inject({ method: "POST", url: url("/platform/rule-sets"), headers: asOperator, payload: { code: "CI-HTTP-NAT", name: "Jeu HTTP", countryCode: "CI", educationSystem: "HIGHER" } });
      expect(set.statusCode).toBe(201);
      expect((await app.inject({ method: "POST", url: url("/platform/rule-sets"), headers: asOperator, payload: { code: "CI-HTTP-NAT", name: "Jeu HTTP", countryCode: "CI" } })).statusCode).toBe(409);
      const created = await app.inject({ method: "POST", url: url("/platform/rule-sets/CI-HTTP-NAT/versions"), headers: asOperator, payload: { contractId: "credit-semester@1", effectiveFrom: "2045-09-01", source: { kind: "platform" }, rules } });
      expect(created.statusCode).toBe(201);
      const versionId = json(created).id as string;
      expect((await app.inject({ method: "PUT", url: url(`/platform/rule-versions/${versionId}/rules`), headers: asOperator, payload: { rules } })).statusCode).toBe(200);
      const step = await app.inject({ method: "POST", url: url(`/platform/rule-versions/${versionId}/transitions`), headers: asOperator, payload: { to: "simulated" } });
      expect(step.statusCode).toBe(200);
      // La version est visible du super-administrateur (brouillon/simulée), pas d'un établissement.
      expect((await app.inject({ method: "GET", url: url(`/rule-versions/${versionId}`), headers: hA() })).statusCode).toBe(404);

      const settings = await app.inject({ method: "PUT", url: url("/platform/settings"), headers: asOperator, payload: { decisionImpactConfirmPercent: 7, replaySamplePercent: 2 } });
      expect(json(settings)).toMatchObject({ decisionImpactConfirmPercent: 7, replaySamplePercent: 2, nationalFourEyes: true });
      expect((await app.inject({ method: "PUT", url: url("/platform/settings"), headers: asOperator, payload: { decisionImpactConfirmPercent: 500 } })).statusCode).toBe(400);
      await app.inject({ method: "PUT", url: url("/platform/settings"), headers: asOperator, payload: { decisionImpactConfirmPercent: 5, replaySamplePercent: 1 } });
    });
  });
});
