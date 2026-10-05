/**
 * HTTP sur base réelle : MATRICE DE PERMISSIONS (chaque route exige sa permission du manifeste, et AUCUNE route n'échappe à la matrice),
 * validation Zod, vue famille (tutelle relue à chaque requête, 404 hors périmètre), téléchargement des documents, aucune donnée personnelle
 * dans les événements ni dans l'audit.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { bulkSaveScores } from "../../application/scores";
import { getSessionDetail, transitionSession } from "../../application/sessions";
import { saveResults } from "../../application/results";
import { issueDocument } from "../../application/issued-documents";
import { createCenter, createRoom } from "../../application/reference";
import { assignCandidate, setSessionCenters } from "../../application/assignments";
import { examinationsPlugin } from "../../http/plugin";
import { bodylessMethodsCompat } from "../../../../platform/http-compat";
import manifest from "../../manifest";
import { describeIntegration } from "../support/db";
import { addPupils, openSession, registerPupil, seedPack, setupEnv, type Env } from "../support/env";

type Verb = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const U = "0192f0a4-7b1e-7c3a-8d2e-00000000aaaa";

/** [méthode, chemin, permissions dont UNE suffit]. Les identifiants sont des UUID quelconques. */
const MATRIX: Array<[Verb, string, string[]]> = [
  ["GET", "/exam-types", ["exam.type.read"]],
  ["POST", "/exam-types", ["exam.type.manage"]],
  ["POST", "/exam-types/instantiate-pack", ["exam.type.manage"]],
  ["GET", `/exam-types/${U}`, ["exam.type.read"]],
  ["PATCH", `/exam-types/${U}`, ["exam.type.manage"]],
  ["POST", `/exam-types/${U}/tracks`, ["exam.type.manage"]],
  ["PATCH", `/exam-types/${U}/tracks/${U}`, ["exam.type.manage"]],
  ["POST", `/exam-types/${U}/papers`, ["exam.type.manage"]],
  ["PATCH", `/exam-types/${U}/papers/${U}`, ["exam.type.manage"]],
  ["POST", `/exam-types/${U}/document-requirements`, ["exam.type.manage"]],
  ["PATCH", `/exam-types/${U}/document-requirements/${U}`, ["exam.type.manage"]],
  ["GET", "/centers", ["exam.center.manage", "exam.session.read"]],
  ["POST", "/centers", ["exam.center.manage"]],
  ["PATCH", `/centers/${U}`, ["exam.center.manage"]],
  ["POST", `/centers/${U}/rooms`, ["exam.center.manage"]],
  ["PATCH", `/centers/${U}/rooms/${U}`, ["exam.center.manage"]],
  ["GET", "/sessions", ["exam.session.read"]],
  ["POST", "/sessions", ["exam.session.manage"]],
  ["GET", `/sessions/${U}`, ["exam.session.read"]],
  ["PATCH", `/sessions/${U}`, ["exam.session.manage"]],
  ["POST", `/sessions/${U}/instantiate`, ["exam.session.manage"]],
  ["POST", `/sessions/${U}/transition`, ["exam.session.manage"]],
  ["GET", `/sessions/${U}/candidates`, ["exam.candidate.read", "exam.candidate.manage"]],
  ["POST", `/sessions/${U}/candidates`, ["exam.candidate.manage"]],
  ["POST", `/sessions/${U}/candidates/from-classroom`, ["exam.candidate.manage"]],
  ["POST", `/sessions/${U}/candidates/register-batch`, ["exam.candidate.manage"]],
  ["POST", `/sessions/${U}/eligibility/evaluate-all`, ["exam.eligibility.evaluate"]],
  ["GET", `/candidates/${U}`, ["exam.candidate.read", "exam.candidate.manage"]],
  ["PATCH", `/candidates/${U}`, ["exam.candidate.manage"]],
  ["POST", `/candidates/${U}/register`, ["exam.candidate.manage"]],
  ["POST", `/candidates/${U}/withdraw`, ["exam.candidate.manage"]],
  ["POST", `/candidates/${U}/eligibility`, ["exam.eligibility.evaluate"]],
  ["GET", `/candidates/${U}/documents`, ["exam.candidate.read", "exam.candidate.manage"]],
  ["PUT", `/candidates/${U}/documents/${U}`, ["exam.candidate.manage"]],
  ["PUT", `/candidates/${U}/identifiers`, ["exam.candidate.manage"]],
  ["POST", `/sessions/${U}/external-candidates`, ["exam.external.manage"]],
  ["POST", `/sessions/${U}/external-candidates/batch`, ["exam.external.manage"]],
  ["GET", `/candidates/${U}/external-profile`, ["exam.external.read"]],
  ["PUT", `/candidates/${U}/external-profile`, ["exam.external.manage"]],
  ["POST", `/candidates/${U}/anonymize`, ["exam.external.anonymize"]],
  ["GET", `/exam-types/${U}/fee-items`, ["exam.fee.read", "exam.fee.manage"]],
  ["PUT", `/exam-types/${U}/fee-items`, ["exam.fee.manage"]],
  ["GET", "/fee-catalog", ["exam.fee.manage"]],
  ["GET", `/candidates/${U}/fee`, ["exam.fee.read", "exam.fee.manage"]],
  ["POST", `/candidates/${U}/fee/sync`, ["exam.fee.manage"]],
  ["POST", `/candidates/${U}/fee/refund-done`, ["exam.fee.manage"]],
  ["POST", `/sessions/${U}/fees/sync`, ["exam.fee.manage"]],
  ["GET", `/sessions/${U}/centers`, ["exam.center.manage", "exam.session.read"]],
  ["PUT", `/sessions/${U}/centers`, ["exam.center.manage"]],
  ["POST", `/sessions/${U}/assignments/auto`, ["exam.center.manage"]],
  ["PUT", `/assignments/${U}`, ["exam.center.manage"]],
  ["DELETE", `/assignments/${U}`, ["exam.center.manage"]],
  ["GET", `/sessions/${U}/scores`, ["exam.score.enter", "exam.result.read"]],
  ["PUT", `/sessions/${U}/scores/bulk`, ["exam.score.enter"]],
  ["GET", `/sessions/${U}/results`, ["exam.result.read", "exam.result.enter"]],
  ["PUT", `/sessions/${U}/results`, ["exam.result.enter"]],
  ["POST", `/results/${U}/publish`, ["exam.result.publish"]],
  ["POST", `/results/${U}/revisions`, ["exam.result.enter", "exam.result.revise"]],
  ["POST", `/scores/${U}/revisions`, ["exam.result.enter", "exam.result.revise"]],
  ["GET", `/sessions/${U}/revision-requests`, ["exam.result.read", "exam.result.revise"]],
  ["POST", `/revision-requests/${U}/approve`, ["exam.result.revise"]],
  ["POST", `/revision-requests/${U}/reject`, ["exam.result.revise"]],
  ["GET", "/import-formats", ["exam.import.manage", "exam.session.read"]],
  ["POST", "/import-formats", ["exam.import.manage"]],
  ["GET", `/import-formats/${U}`, ["exam.import.manage", "exam.session.read"]],
  ["PATCH", `/import-formats/${U}`, ["exam.import.manage"]],
  ["POST", `/import-formats/${U}/publish`, ["exam.import.manage"]],
  ["GET", `/sessions/${U}/imports`, ["exam.import.manage"]],
  ["POST", `/sessions/${U}/imports`, ["exam.import.manage"]],
  ["GET", `/imports/${U}`, ["exam.import.manage"]],
  ["POST", `/imports/${U}/validate`, ["exam.import.manage"]],
  ["POST", `/imports/${U}/apply`, ["exam.result.release"]],
  ["GET", `/sessions/${U}/mock/links`, ["exam.mock.manage"]],
  ["POST", `/sessions/${U}/mock/link`, ["exam.mock.manage"]],
  ["DELETE", `/sessions/${U}/mock/links/${U}`, ["exam.mock.manage"]],
  ["POST", `/sessions/${U}/mock/import-from-assess`, ["exam.mock.manage"]],
  ["POST", `/sessions/${U}/mock/compute`, ["exam.mock.manage"]],
  ["GET", `/sessions/${U}/statistics`, ["exam.statistics.read"]],
  ["GET", "/export-formats", ["exam.export.manage", "exam.export.run"]],
  ["POST", "/export-formats", ["exam.export.manage"]],
  ["GET", `/export-formats/${U}`, ["exam.export.manage", "exam.export.run"]],
  ["PATCH", `/export-formats/${U}`, ["exam.export.manage"]],
  ["POST", `/export-formats/${U}/publish`, ["exam.export.manage"]],
  ["POST", `/export-formats/${U}/new-version`, ["exam.export.manage"]],
  ["GET", `/sessions/${U}/exports`, ["exam.export.run"]],
  ["POST", `/sessions/${U}/exports`, ["exam.export.run"]],
  ["GET", `/exports/${U}`, ["exam.export.run"]],
  ["GET", `/exports/${U}/download`, ["exam.export.run"]],
  ["GET", `/sessions/${U}/issued-documents`, ["exam.document.issue"]],
  ["POST", `/sessions/${U}/documents/issue-batch`, ["exam.document.issue"]],
  ["POST", `/candidates/${U}/documents/issue`, ["exam.document.issue"]],
  ["POST", `/issued-documents/${U}/revoke`, ["exam.document.issue"]],
  ["GET", `/issued-documents/${U}/file`, ["exam.document.issue"]],
  ["GET", "/me/exams", ["exam.document.self.read"]],
  ["GET", "/me/exam-documents", ["exam.document.self.read"]],
  ["GET", "/family/exams", ["exam.document.child.read"]],
  ["GET", `/children/${U}/exams`, ["exam.document.child.read"]],
  ["GET", `/children/${U}/exam-documents`, ["exam.document.child.read"]],
  ["GET", `/family/exam-documents/${U}/file`, ["exam.document.child.read", "exam.document.self.read"]],
];

describeIntegration("examinations : HTTP", () => {
  let env: Env;
  let app: FastifyInstance;
  const registered: string[] = [];

  const ctxFrom = (request: FastifyRequest): RequestContext => {
    const user = request.headers["x-user"];
    const tenant = request.headers["x-tenant"];
    if (typeof user !== "string" || typeof tenant !== "string") throw new UnauthorizedError();
    return createRequestContext({ tenantId: tenant, userId: user, institutionId: tenant === env.tenantA ? env.institutionA : env.institutionB });
  };

  const call = async (method: Verb, url: string, opts: { perms?: string[]; user?: string; tenant?: string; body?: unknown } = {}) =>
    app.inject({
      method,
      url: `/api/v1/examinations${url}`,
      headers: { "x-user": opts.user ?? env.userA1, "x-tenant": opts.tenant ?? env.tenantA, "x-perms": (opts.perms ?? []).join(","), "content-type": "application/json" },
      ...(method === "GET" || method === "DELETE" ? {} : { payload: JSON.stringify(opts.body ?? {}) }),
    });

  beforeAll(async () => {
    env = await setupEnv();
    app = Fastify({ logger: false });
    await app.register(bodylessMethodsCompat); // DELETE JSON sans corps : comme le serveur réel (platform/http-compat.ts)
    app.addHook("onRoute", (r) => {
      for (const m of Array.isArray(r.method) ? r.method : [r.method]) if (m !== "HEAD" && m !== "OPTIONS") registered.push(`${m} ${r.url.replace("/api/v1/examinations", "")}`);
    });
    await app.register(
      async (scope) => {
        await scope.register(examinationsPlugin, {
          deps: env.deps(),
          resolveContext: ctxFrom,
          requirePermission: (permission) => async (request) => {
            ctxFrom(request);
            const granted = String(request.headers["x-perms"] ?? "").split(",");
            if (!granted.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
          },
        });
      },
      { prefix: "/api/v1/examinations" },
    );
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await env?.drop();
  });

  it("matrice : chaque route refuse sans permission (403), accepte avec l'UNE des permissions, et toutes les permissions existent au manifeste", async () => {
    const known = new Set(manifest.permissions.map((p) => p.key));
    for (const [method, url, perms] of MATRIX) {
      for (const p of perms) expect(known.has(p), `${p} absente du manifeste`).toBe(true);
      const denied = await call(method, url, { perms: [] });
      expect(denied.statusCode, `${method} ${url} sans permission`).toBe(403);
      const wrong = await call(method, url, { perms: ["exam.type.read", "exam.result.release", "exam.document.self.read"].filter((p) => !perms.includes(p)) });
      expect(wrong.statusCode, `${method} ${url} avec une autre permission`).toBe(403);
      for (const p of perms) {
        const res = await call(method, url, { perms: [p] });
        expect(res.statusCode, `${method} ${url} avec ${p} : ${res.body.slice(0, 200)}`).not.toBe(403);
        expect(res.statusCode).not.toBe(401);
        expect(res.statusCode).toBeLessThan(500);
      }
    }
  });

  it("aucune route n'échappe à la matrice (permission ou famille) et sans contexte la réponse est 401", async () => {
    const declared = new Set(MATRIX.map(([m, u]) => `${m} ${u.replace(new RegExp(U, "g"), ":x")}`));
    const actual = new Set(registered.map((r) => r.replace(/:[A-Za-z]+/g, ":x")));
    expect([...actual].filter((r) => !declared.has(r))).toEqual([]);
    expect([...declared].filter((r) => !actual.has(r))).toEqual([]);
    const res = await app.inject({ method: "GET", url: "/api/v1/examinations/sessions" });
    expect(res.statusCode).toBe(401);
  });

  it("la publication d'une session exige la permission SENSIBLE de publication, la dérogation la sienne", async () => {
    const s = await call("POST", `/sessions/${U}/transition`, { perms: ["exam.session.manage"], body: { to: "PUBLISHED" } });
    expect(s.statusCode).toBe(403);
    expect(s.json()).toMatchObject({ code: "examinations.forbidden" });
    const ok = await call("POST", `/sessions/${U}/transition`, { perms: ["exam.session.manage", "exam.result.publish"], body: { to: "PUBLISHED" } });
    expect(ok.statusCode).toBe(404); // session inconnue : la garde est passée
    const d = await call("POST", `/candidates/${U}/eligibility`, { perms: ["exam.eligibility.evaluate"], body: { mode: "OVERRIDE", reason: "Dérogation accordée par le directeur" } });
    expect(d.statusCode).toBe(403);
    const d2 = await call("POST", `/candidates/${U}/eligibility`, { perms: ["exam.eligibility.evaluate", "exam.eligibility.override"], body: { mode: "OVERRIDE", reason: "Dérogation accordée par le directeur" } });
    expect(d2.statusCode).toBe(404);
  });

  it("entrées invalides : 400 avec code stable, jamais une 500 ; erreurs de la base traduites ; réponses sans cache", async () => {
    const bad = await call("POST", "/sessions", { perms: ["exam.session.manage"], body: { examTypeId: "pas-un-uuid" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: "examinations.invalid_input" });
    expect(bad.headers["cache-control"]).toBe("no-store");
    const extra = await call("POST", "/centers", { perms: ["exam.center.manage"], body: { code: "C1", name: "Centre", kind: "OWN", inconnu: 1 } });
    expect(extra.statusCode).toBe(400);
    const notUuid = await call("GET", "/sessions/xyz", { perms: ["exam.session.read"] });
    expect(notUuid.statusCode).toBe(400);
    const dupCenter = await call("POST", "/centers", { perms: ["exam.center.manage"], body: { code: "DUP", name: "Un", kind: "OWN" } });
    expect(dupCenter.statusCode).toBe(201);
    const again = await call("POST", "/centers", { perms: ["exam.center.manage"], body: { code: "DUP", name: "Deux", kind: "HOST" } });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: "examinations.code_taken" });
    const noCsvDelimiter = await call("POST", "/export-formats", { perms: ["exam.export.manage"], body: { code: "SANS_SEP", label: "x", kind: "CANDIDATE_LIST", fileFormat: "CSV", columns: [{ header: "N", source: "candidate.number" }] } });
    expect(noCsvDelimiter.statusCode).toBe(400);
    expect(noCsvDelimiter.json()).toMatchObject({ code: "examinations.format_invalid" });
    const injected = await call("POST", "/export-formats", { perms: ["exam.export.manage"], body: { code: "INJECT", label: "x", kind: "CANDIDATE_LIST", fileFormat: "CSV", delimiter: ";", columns: [{ header: "N", source: "candidate.number", transform: "system('rm')" }] } });
    expect(injected.statusCode).toBe(400);
  });

  it("vue famille : le parent voit les examens de SES enfants liés ; 404 pour les autres ; le lien est relu à chaque requête", async () => {
    await seedPack(env);
    const session = await openSession(env, "CEPE-FAM", { startsOn: "2027-06-10" });
    const { pupils } = addPupils(env, 2, { prefix: "FAMILLE" });
    const regs = [];
    for (const p of pupils) regs.push(await registerPupil(env, env.ctxA(), session.id, p));
    const parentOfFirst = newId();
    const parentOfSecond = newId();
    env.world.guardianship.set(parentOfFirst, new Set([pupils[0]!.studentId]));
    env.world.guardianship.set(parentOfSecond, new Set([pupils[1]!.studentId]));
    const center = unwrap(await createCenter(env.deps(), env.ctxA(), { code: "CF", name: "Centre famille (fictif)", kind: "OWN" }));
    unwrap(await createRoom(env.deps(), env.ctxA(), center.id, { code: "SF", capacity: 10 }));
    unwrap(await setSessionCenters(env.deps(), env.ctxA(), session.id, [center.id]));
    const room = (await env.db.admin.query("SELECT id FROM examinations.rooms WHERE center_id = $1", [center.id])).rows[0].id as string;
    for (const r of regs) unwrap(await assignCandidate(env.deps(), env.ctxA(), r.candidateId, { centerId: center.id, roomId: room }));
    unwrap(await issueDocument(env.deps(), env.ctxA(), regs[0]!.candidateId, "CONVOCATION"));

    const perms = ["exam.document.child.read"];
    const mine = await call("GET", `/children/${pupils[0]!.studentId}/exams`, { perms, user: parentOfFirst });
    expect(mine.statusCode).toBe(200);
    const item = mine.json().items[0];
    (await import("@ecoledigitale/contracts/src/v2/examinations")).examFamilyExamDtoSchema.parse(item);
    expect(item).toMatchObject({ candidateNumber: "CEPE2027-00001", outcome: null, assignment: { roomCode: "SF", seatNumber: 1 }, demoRules: true });
    expect(item.documents).toHaveLength(1);
    // pas de note, de moyenne ni de rang dans ce que voit la famille
    expect(JSON.stringify(mine.json())).not.toMatch(/average|moyenne|score|rank/);
    const other = await call("GET", `/children/${pupils[1]!.studentId}/exams`, { perms, user: parentOfFirst });
    expect(other.statusCode).toBe(404);
    const all = await call("GET", "/family/exams", { perms, user: parentOfFirst });
    expect(all.json().items).toHaveLength(1);
    // lien rompu entre deux requêtes : accès refusé immédiatement
    env.world.guardianship.set(parentOfFirst, new Set());
    expect((await call("GET", `/children/${pupils[0]!.studentId}/exams`, { perms, user: parentOfFirst })).statusCode).toBe(404);
    env.world.guardianship.set(parentOfFirst, new Set([pupils[0]!.studentId]));
    // téléchargement : le PDF scellé de SON enfant, 404 pour le parent d'un autre
    const docId = item.documents[0].id as string;
    const file = await call("GET", `/family/exam-documents/${docId}/file`, { perms, user: parentOfFirst });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect(file.rawPayload.subarray(0, 4).toString()).toBe("%PDF");
    expect((await call("GET", `/family/exam-documents/${docId}/file`, { perms, user: parentOfSecond })).statusCode).toBe(404);
    // l'élève lui-même
    const self = newId();
    env.world.studentAccounts.set(self, pupils[0]!.studentId);
    const mineSelf = await call("GET", "/me/exams", { perms: ["exam.document.self.read"], user: self });
    expect(mineSelf.json().items).toHaveLength(1);
    // l'issue n'apparaît qu'une fois publiée, sans note
    unwrap(await transitionSession(env.deps(), env.ctxA(), session.id, "REGISTRATION_CLOSED"));
    unwrap(await transitionSession(env.deps(), env.ctxA(), session.id, "IN_PROGRESS"));
    const detail = unwrap(await getSessionDetail(env.deps(), env.ctxA(), session.id));
    unwrap(await bulkSaveScores(env.deps(), env.ctxA(), session.id, { items: [{ candidateId: regs[0]!.candidateId, paperId: detail.papers[0]!.id, status: "ENTERED", score: "17" }] }));
    unwrap(await saveResults(env.deps(), env.ctxA(), session.id, { items: regs.map((r) => ({ candidateId: r.candidateId, resultCode: "ADMITTED" as const, average: "17" })) }));
    unwrap(await transitionSession(env.deps(), env.ctxA(), session.id, "RESULTS_ENTERED"));
    expect((await call("GET", `/children/${pupils[0]!.studentId}/exams`, { perms, user: parentOfFirst })).json().items[0].outcome).toBeNull(); // brouillon : pas visible
    unwrap(await transitionSession(env.deps(), env.ctxA(), session.id, "PUBLISHED"));
    const published = (await call("GET", `/children/${pupils[0]!.studentId}/exams`, { perms, user: parentOfFirst })).json().items[0];
    expect(published.outcome).toBe("ADMITTED");
    expect(JSON.stringify(published)).not.toMatch(/"average"|"score"|"rank"|"moyenne"/);
  });

  it("aucune donnée personnelle ni note dans les événements ni dans l'audit de tout le parcours", async () => {
    const emitted = (await env.db.admin.query("SELECT type, payload FROM kernel.domain_events WHERE tenant_id = $1 AND type LIKE 'examinations.%'", [env.tenantA])).rows;
    // chaque événement émis a son schéma de charge dans les contrats et le respecte (producteur validé contre son contrat)
    const schemas = (await import("@ecoledigitale/contracts/src/v2/examinations")).examinationsEventPayloadSchemas as Record<string, { parse(v: unknown): unknown }>;
    for (const e of emitted) {
      expect(schemas[e.type as string], e.type).toBeDefined();
      expect(() => schemas[e.type as string]!.parse(e.payload), e.type).not.toThrow();
    }
    const types = new Set(emitted.map((e) => e.type as string));
    for (const t of ["examinations.session.opened", "examinations.candidate.registered", "examinations.result.published", "examinations.document.issued", "examinations.session.results_published"]) expect(types.has(t), t).toBe(true);
    // Q-E18 : la MOYENNE ne voyage que dans l'événement dédié aux admissions ; tous les autres restent sans note ni moyenne.
    const transmitted = emitted.filter((e) => e.type === "examinations.result.transmitted");
    for (const t of transmitted) expect(Object.keys(t.payload as object).sort()).toEqual(["admitted", "average", "candidateId", "examTypeCode", "institutionId", "outcome", "resultId", "revision", "sessionId", "sessionYear", "studentId", "v"]);
    expect(transmitted.map((t) => JSON.stringify(t.payload)).join("\n")).not.toMatch(/FAMILLE|ELEVE|Prénom|Abidjan|2016-05-05/);
    const events = emitted.filter((e) => e.type !== "examinations.result.transmitted").map((r) => JSON.stringify(r.payload)).join("\n");
    expect(events.length).toBeGreaterThan(100);
    expect(events).not.toMatch(/FAMILLE|ELEVE|Prénom|Abidjan|2016-05-05|"17"|average|moyenne/);
    const audits = JSON.stringify(env.audit.entries.map((e) => e.entry));
    expect(audits).not.toMatch(/FAMILLE|ELEVE|Prénom|Abidjan|2016-05-05/);
    expect(audits).not.toMatch(/"score"|"average"/);
    expect(env.audit.entries.length).toBeGreaterThan(20);
  });
});
