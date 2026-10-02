/**
 * HTTP de bout en bout sur une base réelle : matrice des permissions (chaque route refuse sans sa permission et l'accepte avec),
 * garde de feature, validation des entrées (400 stables), refus de la base traduits (jamais de 500), parcours dossier -> vérification
 * -> rapprochement -> créances -> export, vue famille (lien relu à chaque requête), échec fermé (503).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, UnauthorizedError, createRequestContext, type RequestContext } from "@ecoledigitale/kernel";
import { createStateassignDeps } from "../../application/deps";
import { RecordingAudit } from "../../application/ports";
import { stateassignPlugin } from "../../http/plugin";
import { billingOf } from "../../infrastructure/in-memory-ports";
import manifest from "../../manifest";
import { PEOPLE, createEnv, uuid, type Env } from "../support/harness";
import { describeIntegration } from "../support/db";

let env: Env;
let app: FastifyInstance;
let tenant: string;
const PREFIX = "/api/v1/stateassign";

const ALL = manifest.permissions.map((p) => p.key);

beforeAll(async () => {
  env = await createEnv({ startAt: "2026-12-20T09:00:00.000Z" });
  tenant = await env.tenant("http");
  const deps = createStateassignDeps({ db: env.db.tenantDb, clock: env.clock, audit: new RecordingAudit(), ports: env.world });
  app = Fastify({ logger: false });
  app.addHook("onRequest", async (request) => {
    const user = request.headers["x-user"];
    if (!user) throw new UnauthorizedError();
    (request as unknown as { ctx: RequestContext }).ctx = createRequestContext({
      tenantId: String(request.headers["x-tenant"] ?? tenant),
      userId: String(user),
      ...(request.headers["x-institution"] ? { institutionId: String(request.headers["x-institution"]) } : {}),
    });
  });
  await app.register(stateassignPlugin, {
    prefix: PREFIX,
    deps,
    resolveContext: (request) => (request as unknown as { ctx: RequestContext }).ctx,
    requirePermission: (permission) => async (request) => {
      const grants = String(request.headers["x-grants"] ?? "").split(",");
      if (!grants.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
    },
    requireFeature: (feature) => async (request) => {
      if (String(request.headers["x-no-features"] ?? "").split(",").includes(feature)) {
        throw new ForbiddenError("Fonctionnalité non disponible.", { code: "entitlements.feature_not_available", details: { feature } });
      }
    },
  });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await env?.close();
});

interface Call {
  method: "GET" | "POST" | "PUT" | "PATCH";
  url: string;
  payload?: unknown;
}

async function call(who: string, grants: readonly string[], c: Call, extra: Record<string, string> = {}) {
  return app.inject({
    method: c.method,
    url: `${PREFIX}${c.url}`,
    headers: { "x-user": who, "x-grants": grants.join(","), "x-tenant": tenant, ...extra },
    ...(c.payload !== undefined ? { payload: c.payload as object } : {}),
  });
}

const json = (res: { json: () => unknown }): Record<string, any> => res.json() as Record<string, any>;

describeIntegration("stateassign : HTTP", () => {
  const ids = { assignment: uuid(), control: uuid(), document: uuid(), receivable: uuid(), format: uuid(), student: uuid() };
  const inst = uuid();

  /** Chaque route et la permission (une seule suffit) qui la garde. */
  const MATRIX: Array<{ name: string; call: Call; any: string[] }> = [
    { name: "contexte", call: { method: "GET", url: "/me/context" }, any: ALL },
    { name: "lire les réglages", call: { method: "GET", url: `/settings?institutionId=${inst}` }, any: ["stateassign.read", "stateassign.settings.manage"] },
    { name: "écrire les réglages", call: { method: "PUT", url: `/settings?institutionId=${inst}`, payload: { requireSeparateVerifier: true, reconciliationTolerance: 0, requiredControlKinds: [], controlDueOffsetDays: null, receivableGraceDays: 0 } }, any: ["stateassign.settings.manage"] },
    { name: "lister les dossiers", call: { method: "GET", url: "/assignments" }, any: ["stateassign.read"] },
    { name: "enregistrer un dossier", call: { method: "POST", url: "/assignments", payload: { enrollmentId: uuid(), reference: "X" } }, any: ["stateassign.record"] },
    { name: "lire un dossier", call: { method: "GET", url: `/assignments/${ids.assignment}` }, any: ["stateassign.read"] },
    { name: "corriger un dossier", call: { method: "PATCH", url: `/assignments/${ids.assignment}`, payload: { notes: "x", rowVersion: 1 } }, any: ["stateassign.record"] },
    { name: "vérifier", call: { method: "POST", url: `/assignments/${ids.assignment}/verify`, payload: { rowVersion: 1 } }, any: ["stateassign.verify"] },
    { name: "rejeter", call: { method: "POST", url: `/assignments/${ids.assignment}/reject`, payload: { reason: "Acte non reconnu", rowVersion: 1 } }, any: ["stateassign.verify"] },
    { name: "activer", call: { method: "POST", url: `/assignments/${ids.assignment}/activate`, payload: { rowVersion: 1 } }, any: ["stateassign.manage"] },
    { name: "suspendre", call: { method: "POST", url: `/assignments/${ids.assignment}/suspend`, payload: { reason: "Pièces à renouveler", rowVersion: 1 } }, any: ["stateassign.manage"] },
    { name: "reprendre", call: { method: "POST", url: `/assignments/${ids.assignment}/resume`, payload: { rowVersion: 1 } }, any: ["stateassign.manage"] },
    { name: "terminer", call: { method: "POST", url: `/assignments/${ids.assignment}/end`, payload: { endedOn: "2027-06-30", reason: "Fin d'année", rowVersion: 1 } }, any: ["stateassign.manage"] },
    { name: "transférer", call: { method: "POST", url: `/assignments/${ids.assignment}/transfer-out`, payload: { endedOn: "2027-06-30", reason: "Départ de l'établissement", rowVersion: 1 } }, any: ["stateassign.manage"] },
    { name: "amender", call: { method: "POST", url: `/assignments/${ids.assignment}/amend`, payload: { reason: "Avenant n°2", effectiveOn: "2026-12-20", declaredStateAmount: 1, rowVersion: 1 } }, any: ["stateassign.amend"] },
    { name: "rapprocher", call: { method: "POST", url: `/assignments/${ids.assignment}/reconcile` }, any: ["stateassign.reconcile"] },
    { name: "planifier un contrôle", call: { method: "POST", url: `/assignments/${ids.assignment}/controls`, payload: { kind: "IDENTITY", dueOn: "2027-01-01" } }, any: ["stateassign.control.perform"] },
    { name: "faits de présence", call: { method: "GET", url: `/assignments/${ids.assignment}/attendance-facts` }, any: ["stateassign.read", "stateassign.control.perform"] },
    { name: "réaliser un contrôle", call: { method: "POST", url: `/controls/${ids.control}/complete`, payload: { outcome: "OK" } }, any: ["stateassign.control.perform"] },
    { name: "dispenser un contrôle", call: { method: "POST", url: `/controls/${ids.control}/waive`, payload: { reason: "Élève en stage" } }, any: ["stateassign.control.perform"] },
    { name: "résoudre une anomalie", call: { method: "POST", url: `/controls/${ids.control}/resolve`, payload: { resolution: "Justificatifs reçus" } }, any: ["stateassign.control.perform"] },
    { name: "rattacher une pièce", call: { method: "POST", url: `/assignments/${ids.assignment}/documents`, payload: { kind: "OTHER", documentRef: uuid() } }, any: ["stateassign.document.manage"] },
    { name: "retirer une pièce", call: { method: "POST", url: `/documents/${ids.document}/withdraw`, payload: { reason: "Pièce remplacée" } }, any: ["stateassign.document.manage"] },
    { name: "lister les créances", call: { method: "GET", url: "/receivables" }, any: ["stateassign.read"] },
    { name: "ancienneté des créances", call: { method: "GET", url: "/receivables/aging" }, any: ["stateassign.read"] },
    { name: "planifier une échéance", call: { method: "POST", url: `/assignments/${ids.assignment}/receivables`, payload: { label: "1er", dueOn: "2027-01-01", expectedAmount: 1000 } }, any: ["stateassign.receivable.manage"] },
    { name: "modifier une échéance", call: { method: "PATCH", url: `/receivables/${ids.receivable}`, payload: { label: "x", rowVersion: 1 } }, any: ["stateassign.receivable.manage"] },
    { name: "annuler une échéance", call: { method: "POST", url: `/receivables/${ids.receivable}/cancel`, payload: { reason: "Erreur de saisie", rowVersion: 1 } }, any: ["stateassign.receivable.manage"] },
    { name: "historique d'une échéance", call: { method: "GET", url: `/receivables/${ids.receivable}/history` }, any: ["stateassign.read"] },
    { name: "tableau de bord", call: { method: "GET", url: "/reports/summary" }, any: ["stateassign.read"] },
    { name: "état de rapprochement", call: { method: "GET", url: "/reports/reconciliation" }, any: ["stateassign.read", "stateassign.reconcile"] },
    { name: "contrôles à faire", call: { method: "GET", url: "/reports/controls-due" }, any: ["stateassign.read", "stateassign.control.perform"] },
    { name: "catalogue d'export", call: { method: "GET", url: "/exports/catalog" }, any: ["stateassign.export", "stateassign.settings.manage"] },
    { name: "lister les formats", call: { method: "GET", url: "/export-formats" }, any: ["stateassign.export", "stateassign.settings.manage"] },
    { name: "créer un format", call: { method: "POST", url: "/export-formats", payload: { institutionId: inst, code: "fmt-x", label: "F", dataset: "ASSIGNMENTS", columns: [{ key: "reference", header: "R" }] } }, any: ["stateassign.settings.manage"] },
    { name: "modifier un format", call: { method: "PATCH", url: `/export-formats/${ids.format}`, payload: { label: "x" } }, any: ["stateassign.settings.manage"] },
    { name: "exporter", call: { method: "GET", url: "/exports/assignments" }, any: ["stateassign.export"] },
    { name: "méta d'export", call: { method: "GET", url: "/exports/assignments/meta" }, any: ["stateassign.export"] },
    { name: "état de la passerelle", call: { method: "GET", url: "/gateway/status" }, any: ["stateassign.read"] },
    { name: "famille : statut de l'enfant", call: { method: "GET", url: `/children/${ids.student}/assignment` }, any: ["stateassign.child.read"] },
  ];

  it("matrice : chaque route refuse (403) sans sa permission, quelle que soit celle qu'on accorde d'autre, et ne refuse plus (≠ 401/403) avec elle", async () => {
    for (const row of MATRIX) {
      const others = ALL.filter((p) => !row.any.includes(p));
      const denied = await call(PEOPLE.bursar, others, row.call);
      expect(denied.statusCode, `${row.name} : doit refuser sans ${row.any.join(" | ")}`).toBe(403);
      expect(json(denied).code).toBeDefined();
      for (const permission of row.any) {
        const res = await call(PEOPLE.bursar, [permission], row.call);
        expect([401, 403], `${row.name} avec ${permission} : ${res.statusCode} ${res.body.slice(0, 200)}`).not.toContain(res.statusCode);
        expect(res.statusCode, `${row.name} : jamais de 500`).not.toBe(500);
      }
    }
  });

  it("toute permission référencée par une route existe au manifeste (aucun rôle codé en dur) et le manifeste n'a aucune permission orpheline", () => {
    const used = new Set(MATRIX.flatMap((m) => m.any));
    for (const p of used) expect(ALL, p).toContain(p);
    for (const p of ALL) expect(used.has(p) || p === "stateassign.child.read", `permission non gardée par une route : ${p}`).toBe(true);
  });

  it("sans contexte : 401 ; avec la feature stateassign.core retirée : 403 entitlements.feature_not_available, même pour un utilisateur autorisé", async () => {
    const anon = await app.inject({ method: "GET", url: `${PREFIX}/assignments` });
    expect(anon.statusCode).toBe(401);
    const off = await call(PEOPLE.bursar, ["stateassign.read"], { method: "GET", url: "/assignments" }, { "x-no-features": "stateassign.core" });
    expect(off.statusCode).toBe(403);
    expect(json(off).code).toBe("entitlements.feature_not_available");
  });

  it("parcours : enregistrer (201) -> vérifier (par un autre) -> rapprocher -> échéance -> export CSV, réponses sans cache", async () => {
    const e = env.enroll({ studentName: "KONE Ibrahim" });
    const secretary = (c: Call) => call(PEOPLE.secretary, ["stateassign.read", "stateassign.record", "stateassign.document.manage"], c);
    const bursar = (c: Call) => call(PEOPLE.bursar, ["stateassign.read", "stateassign.verify", "stateassign.manage", "stateassign.reconcile", "stateassign.receivable.manage", "stateassign.export"], c);

    const created = await secretary({ method: "POST", url: "/assignments", payload: { enrollmentId: e.enrollmentId, reference: " AFF-HTTP-1 ", declaredStateAmount: 400000, declaredParentAmount: 100000, issuedOn: "2026-09-15", issuingAuthority: "Autorité" } });
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    const a = json(created);
    expect(a).toMatchObject({ status: "RECEIVED", reference: "AFF-HTTP-1", declaredState: { amount: 400000, currency: "XOF" } });

    // l'enregistrant ne vérifie pas son propre dossier
    const self = await call(PEOPLE.secretary, ["stateassign.verify"], { method: "POST", url: `/assignments/${a.id}/verify`, payload: { rowVersion: a.rowVersion } });
    expect(self.statusCode).toBe(403);
    expect(json(self).code).toBe("stateassign.four_eyes_required");

    const verified = await bursar({ method: "POST", url: `/assignments/${a.id}/verify`, payload: { rowVersion: a.rowVersion, note: "Conforme" } });
    expect(verified.statusCode).toBe(200);
    expect(json(verified)).toMatchObject({ status: "VERIFIED", verifiedBy: PEOPLE.bursar });
    const stale = await bursar({ method: "POST", url: `/assignments/${a.id}/activate`, payload: { rowVersion: a.rowVersion } });
    expect(stale.statusCode).toBe(409);
    expect(json(stale).code).toBe("stateassign.version_conflict");
    const active = await bursar({ method: "POST", url: `/assignments/${a.id}/activate`, payload: { rowVersion: json(verified).rowVersion } });
    expect(json(active).status).toBe("ACTIVE");

    env.world.setBilling(e.enrollmentId, billingOf({ stateTotal: 400000, statePaid: 100000, parentTotal: 100000 }));
    const sched = await bursar({ method: "POST", url: `/assignments/${a.id}/receivables`, payload: { label: "1er versement", dueOn: "2026-11-15", expectedAmount: 150000 } });
    expect(sched.statusCode).toBe(201);
    const over = await bursar({ method: "POST", url: `/assignments/${a.id}/receivables`, payload: { label: "Trop", dueOn: "2027-01-15", expectedAmount: 300000 } });
    expect(over.statusCode).toBe(409);
    expect(json(over).code).toBe("stateassign.receivable_exceeds_declared");
    const rec = await bursar({ method: "POST", url: `/assignments/${a.id}/reconcile` });
    expect(rec.statusCode).toBe(200);
    expect(json(rec)).toMatchObject({ assignment: { reconciliation: { status: "BALANCED" } }, unallocated: { amount: 0 } });
    expect(json(rec).receivables[0]).toMatchObject({ status: "PARTIALLY_RECEIVED", received: { amount: 100000 }, outstanding: { amount: 50000 }, daysOverdue: 35, overdue: true });

    const detail = await bursar({ method: "GET", url: `/assignments/${a.id}` });
    expect(json(detail)).toMatchObject({ assignment: { studentName: "KONE Ibrahim" }, receivablesSummary: { expected: { amount: 150000 }, unscheduled: { amount: 250000 } }, enrollment: { fundingType: "STATE_ASSIGNED", referenceMatchesAssignment: true } });
    expect(json(detail).events.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(["CREATED", "STATUS_CHANGED", "RECONCILED", "LINKED"]));

    const csv = await bursar({ method: "GET", url: `/exports/assignments?institutionId=${e.institutionId}` });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(csv.headers["content-disposition"]).toBe('attachment; filename="stateassign-assignments-2026-12-20.csv"');
    expect(csv.headers["x-export-truncated"]).toBe("false");
    expect(csv.headers["x-export-row-count"]).toBe("1");
    expect(csv.body).toContain("AFF-HTTP-1");
    const meta = await bursar({ method: "GET", url: `/exports/assignments/meta?institutionId=${e.institutionId}` });
    expect(json(meta)).toEqual({ dataset: "ASSIGNMENTS", rowCount: 1, totalCount: 1, truncated: false, maxRows: 50000 });
    const unknown = await bursar({ method: "GET", url: "/exports/inconnu" });
    expect(unknown.statusCode).toBe(400);
  });

  it("entrées strictes : champs inconnus, montants flottants, dates et UUID mal formés -> 400 stable ; refus de la base traduits en 409, jamais 500", async () => {
    const e = env.enroll();
    const rec = (payload: unknown) => call(PEOPLE.secretary, ["stateassign.record"], { method: "POST", url: "/assignments", payload });
    for (const bad of [
      { enrollmentId: e.enrollmentId, reference: "R", declaredStateAmount: 10.5 },
      { enrollmentId: e.enrollmentId, reference: "R", extra: true },
      { enrollmentId: "pas-un-uuid", reference: "R" },
      { enrollmentId: e.enrollmentId, reference: "R", issuedOn: "15/09/2026" },
      { enrollmentId: e.enrollmentId, reference: "" },
    ]) {
      const res = await rec(bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(json(res).code).toBe("stateassign.invalid_input");
    }
    const ok1 = await rec({ enrollmentId: e.enrollmentId, reference: "DUP-1" });
    expect(ok1.statusCode).toBe(201);
    const dup = await rec({ enrollmentId: e.enrollmentId, reference: "DUP-2" });
    expect(dup.statusCode).toBe(409);
    expect(json(dup).code).toBe("stateassign.duplicate_live_assignment");
    expect((await call(PEOPLE.bursar, ["stateassign.read"], { method: "GET", url: "/assignments/pas-un-uuid" })).statusCode).toBe(400);
    expect((await call(PEOPLE.bursar, ["stateassign.read"], { method: "GET", url: `/assignments/${uuid()}` })).statusCode).toBe(404);
    expect((await call(PEOPLE.bursar, ["stateassign.read"], { method: "GET", url: "/assignments?pageSize=999" })).statusCode).toBe(400);
  });

  it("échec fermé : un port absent répond 503 stateassign.port_unavailable (rien n'est écrit)", async () => {
    const bare = Fastify({ logger: false });
    bare.addHook("onRequest", async (request) => {
      (request as unknown as { ctx: RequestContext }).ctx = createRequestContext({ tenantId: tenant, userId: PEOPLE.secretary });
    });
    await bare.register(stateassignPlugin, {
      deps: createStateassignDeps({ db: env.db.tenantDb, clock: env.clock, audit: new RecordingAudit() }),
      resolveContext: (request) => (request as unknown as { ctx: RequestContext }).ctx,
      requirePermission: () => async () => undefined,
    });
    const res = await bare.inject({ method: "POST", url: "/assignments", payload: { enrollmentId: uuid(), reference: "X" } });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("stateassign.port_unavailable");
    await bare.close();
  });

  it("vue FAMILLE : le parent lié voit le statut, jamais les montants ; un enfant non lié répond 404 (aucune fuite) ; le lien est relu à chaque requête", async () => {
    const e = env.enroll();
    const a = json(await call(PEOPLE.secretary, ["stateassign.record"], { method: "POST", url: "/assignments", payload: { enrollmentId: e.enrollmentId, reference: "FAM-H1", declaredStateAmount: 400000 } }));
    const family = (studentId: string) => call(PEOPLE.parent, ["stateassign.child.read"], { method: "GET", url: `/children/${studentId}/assignment` });
    expect((await family(e.studentId)).statusCode).toBe(404); // pas encore lié
    env.world.linkGuardian(PEOPLE.parent, e.studentId);
    const res = await family(e.studentId);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ studentId: e.studentId, hasAssignment: true, status: "RECEIVED", verified: false, reference: "FAM-H1" });
    expect(res.body).not.toMatch(/400000|declared|amount/i);
    // la famille n'a aucun accès aux routes du personnel
    expect((await call(PEOPLE.parent, ["stateassign.child.read"], { method: "GET", url: `/assignments/${a.id}` })).statusCode).toBe(403);
    expect((await call(PEOPLE.parent, ["stateassign.child.read"], { method: "GET", url: "/receivables" })).statusCode).toBe(403);
    // lien retiré : l'accès disparaît à la requête suivante
    env.world.links.get(PEOPLE.parent)!.delete(e.studentId);
    expect((await family(e.studentId)).statusCode).toBe(404);
  });

  it("périmètre d'établissement : un contexte lié à un établissement ne lit pas les dossiers d'un autre", async () => {
    const e1 = env.enroll();
    const e2 = env.enroll();
    const a1 = json(await call(PEOPLE.secretary, ["stateassign.record"], { method: "POST", url: "/assignments", payload: { enrollmentId: e1.enrollmentId, reference: "SC-1" } }));
    const a2 = json(await call(PEOPLE.secretary, ["stateassign.record"], { method: "POST", url: "/assignments", payload: { enrollmentId: e2.enrollmentId, reference: "SC-2" } }));
    const scoped = { "x-institution": e1.institutionId };
    expect((await call(PEOPLE.bursar, ["stateassign.read"], { method: "GET", url: `/assignments/${a1.id}` }, scoped)).statusCode).toBe(200);
    expect((await call(PEOPLE.bursar, ["stateassign.read"], { method: "GET", url: `/assignments/${a2.id}` }, scoped)).statusCode).toBe(404);
    const list = json(await call(PEOPLE.bursar, ["stateassign.read"], { method: "GET", url: "/assignments" }, scoped));
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([a1.id]);
  });

  it("passerelle : l'état dit « NotConfigured » ; sa route d'appel exige la feature réservée (indisponible en V1)", async () => {
    const status = await call(PEOPLE.bursar, ["stateassign.read"], { method: "GET", url: "/gateway/status" });
    expect(json(status)).toMatchObject({ configured: false, adapter: "NotConfigured" });
    const fetch = await call(PEOPLE.secretary, ["stateassign.record"], { method: "POST", url: "/gateway/fetch", payload: { reference: "AFF-1" } });
    expect(fetch.statusCode).toBe(503); // adaptateur NotConfigured : indisponible, explicite
    expect(json(fetch).code).toBe("stateassign.gateway_not_configured");
    const off = await call(PEOPLE.secretary, ["stateassign.record"], { method: "POST", url: "/gateway/fetch", payload: { reference: "AFF-1" } }, { "x-no-features": "stateassign.gateway" });
    expect(off.statusCode).toBe(403);
    expect(json(off).code).toBe("entitlements.feature_not_available");
  });
});
