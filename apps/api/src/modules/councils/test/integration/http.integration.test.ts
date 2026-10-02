/**
 * API HTTP /api/v1/councils/* (Fastify + Postgres réel). L'authentification est simulée en amont (`request.ctx`) : le module ne lit jamais
 * d'identité dans la requête. Les permissions sont celles du manifeste, évaluées par une garde de test (qui enregistre aussi chaque
 * permission demandée : toutes celles du manifeste doivent protéger une route, aucune hors manifeste).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError, type RequestContext } from "@ecoledigitale/kernel";
import * as C from "@ecoledigitale/contracts/src/v2/councils";
import manifest from "../../manifest";
import { councilsPlugin } from "../../http/plugin";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "../support/db";
import { freshClassroom, makeWorld, type TestWorld } from "../support/world";

const ALL = manifest.permissions.map((p) => p.key);
const SECRETARY = ["council.read", "council.manage", "council.prepare", "council.minutes.generate", "council.minutes.read", "council.minutes.sign", "council.unlock.request"];
const TEACHER = ["council.proposal.write"];
const PARENT = ["council.child.read"];
const PUPIL = ["council.self.read"];

interface Who {
  ctx: RequestContext;
  perms: string[];
}

describeIntegration("API HTTP /api/v1/councils/* (Fastify + Postgres réel)", () => {
  let db: ModuleTestDb;
  let w: TestWorld;
  let app: FastifyInstance;
  const identities = new Map<string, Who>();
  const features = new Set(["councils.core", "councils.orientation"]);
  const requested = new Set<string>();

  const call = async (who: string | null, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown) => {
    const res = await app.inject({ method, url: `/api/v1/councils${url}`, headers: who ? { "x-test-identity": who } : {}, ...(body !== undefined ? { payload: body as never } : {}) });
    let json: any = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      /* corps non JSON */
    }
    return { status: res.statusCode, json, headers: res.headers };
  };

  beforeAll(async () => {
    db = await createModuleTestDb();
    w = await makeWorld(db);
    identities.set("director", { ctx: w.director.ctx, perms: ALL });
    identities.set("director2", { ctx: w.director2.ctx, perms: ALL });
    identities.set("secretary", { ctx: w.secretary.ctx, perms: SECRETARY });
    identities.set("teacher", { ctx: w.teacher.ctx, perms: TEACHER });
    identities.set("outsider", { ctx: w.outsiderTeacher.ctx, perms: TEACHER });
    identities.set("parent", { ctx: w.guardian.ctx, perms: PARENT });
    identities.set("otherParent", { ctx: w.otherGuardian.ctx, perms: PARENT });
    identities.set("pupil", { ctx: w.pupil.ctx, perms: PUPIL });
    identities.set("system", { ctx: w.systemCtx(), perms: ALL });
    identities.set("nobody", { ctx: w.person("Sans droit").ctx, perms: [] });
    w.ports.addGuardian(w.guardian.userId, w.students[0]!.studentId);
    w.ports.linkStudentUser(w.pupil.userId, w.students[0]!.studentId);
    app = Fastify({ logger: false });
    app.addHook("onRequest", async (req) => {
      const id = req.headers["x-test-identity"];
      const who = typeof id === "string" ? identities.get(id) : undefined;
      if (who) (req as unknown as { ctx: RequestContext }).ctx = who.ctx;
    });
    const requirePermission = (permission: string) => {
      requested.add(permission);
      return async function guard(this: FastifyInstance, req: FastifyRequest): Promise<void> {
        const id = req.headers["x-test-identity"];
        const who = typeof id === "string" ? identities.get(id) : undefined;
        if (!who) throw new UnauthorizedError();
        if (!who.perms.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      };
    };
    await app.register(
      async (scope) => {
        await scope.register(councilsPlugin, {
          deps: w.deps,
          requirePermission,
          requireFeature: (feature: string) =>
            async function gate() {
              if (!features.has(feature)) throw new ForbiddenError("Fonctionnalité non disponible.", { code: "entitlements.feature_not_available", details: { feature } });
            },
        });
      },
      { prefix: "/api/v1/councils" },
    );
    await app.ready();
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it("401 sans identité, 403 sans permission (code stable), réponses jamais mises en cache", async () => {
    expect((await call(null, "GET", "/councils")).status).toBe(401);
    const denied = await call("teacher", "POST", "/councils", { classroomId: w.classroomId, academicPeriodId: w.periodId, councilTypeId: w.types.PERIOD });
    expect(denied.status).toBe(403);
    expect(denied.headers["cache-control"]).toBe("no-store");
    const nobody = await call("nobody", "GET", "/councils");
    expect(nobody.status).toBe(403);
    for (const [method, url] of [["POST", "/councils/00000000-0000-4000-8000-000000000001/open"], ["POST", "/minutes/00000000-0000-4000-8000-000000000001/sign"], ["PUT", "/settings"], ["POST", "/effects/00000000-0000-4000-8000-000000000001/apply"]] as const) {
      expect((await call("nobody", method, url, {})).status, `${method} ${url}`).toBe(403);
    }
  });

  it("entrées strictes : champ inconnu refusé (aucun champ « décideur » / « statut » accepté), identifiant non UUID refusé, 400 avec les champs fautifs", async () => {
    const spoof = await call("director", "POST", "/councils", { classroomId: w.classroomId, academicPeriodId: w.periodId, councilTypeId: w.types.PERIOD, status: "OPEN", createdBy: w.director2.userId });
    expect(spoof.status).toBe(400);
    const bad = await call("director", "POST", "/councils", { classroomId: "pas-un-uuid", councilTypeId: w.types.PERIOD });
    expect(bad.status).toBe(400);
    expect(bad.json.issues.map((i: { path: string[] }) => i.path[0])).toContain("classroomId");
    expect((await call("director", "GET", "/councils/pas-un-uuid")).status).toBe(400);
    const decision = await call("director", "POST", `/agenda/${w.director.userId}/decisions`, { decisionTypeId: w.decisionTypes.PASSAGE, deciderParticipantId: w.director.userId, recordedBy: w.director2.userId });
    expect(decision.status).toBe(400);
    const vote = await call("director", "POST", `/agenda/${w.director.userId}/decisions`, { decisionTypeId: w.decisionTypes.PASSAGE, deciderParticipantId: w.director.userId, mode: "VOTE" });
    expect(vote.status).toBe(400);
  });

  it("parcours HTTP : créer, préparer, ouvrir, lire la fiche élève ; contrats de réponse ; seul l'humain connecté agit", async () => {
    const created = await call("director", "POST", "/councils", { classroomId: w.classroomId, academicPeriodId: w.periodId, councilTypeId: w.types.PERIOD, title: "Conseil du premier trimestre", scheduledAt: "2026-11-10T10:00:00Z" });
    expect(created.status).toBe(201);
    const council = C.councilsCouncilDtoSchema.parse(created.json);
    expect(council).toMatchObject({ status: "PLANNED", ruleSourceKind: "placeholder", classroomName: "6e A", periodLabel: "Trimestre 1" });
    expect((await call("director", "POST", "/councils", { classroomId: w.classroomId, academicPeriodId: w.periodId, councilTypeId: w.types.PERIOD })).json.code).toBe("councils.duplicate");

    const proposed = await call("secretary", "GET", `/councils/${council.id}/proposed-participants`);
    expect(proposed.status).toBe(200);
    expect(proposed.json.items.map((p: { displayName: string; roleCode: string }) => p.roleCode).sort()).toEqual(["HOMEROOM_TEACHER", "TEACHER"]);
    for (const [staff, roleCode, fn] of [[w.director, "PRESIDENT", "PRESIDENT"], [w.secretary, "SECRETARY", "SECRETARY"], [w.homeroom, "HOMEROOM_TEACHER", null]] as const) {
      const added = await call("secretary", "POST", `/councils/${council.id}/participants`, { roleCode, staffId: staff.staffId, ...(fn ? { councilFunction: fn } : {}) });
      expect(added.status).toBe(201);
      C.councilsParticipantDtoSchema.parse(added.json);
      expect((await call("secretary", "POST", `/councils/${council.id}/participants/${added.json.id}/presence`, { presence: "PRESENT" })).json.presence).toBe("PRESENT");
    }
    const prepared = await call("secretary", "POST", `/councils/${council.id}/prepare`, {});
    expect(prepared.status).toBe(200);
    C.councilsPrepareReportDtoSchema.parse(prepared.json);
    // le secrétariat ne conduit pas la séance (permission sensible dédiée)
    expect((await call("secretary", "POST", `/councils/${council.id}/open`, {})).status).toBe(403);
    // le système, même avec toutes les permissions, est refusé par la règle « l'humain décide »
    const asSystem = await call("system", "POST", `/councils/${council.id}/open`, {});
    expect(asSystem.status).toBe(403);
    expect(asSystem.json.code).toBe("councils.human_decision_required");
    const opened = await call("director", "POST", `/councils/${council.id}/open`, {});
    expect(opened.status).toBe(200);
    C.councilsCouncilDetailDtoSchema.parse(opened.json);
    expect(opened.json.council.status).toBe("OPEN");

    const agenda = await call("director", "GET", `/councils/${council.id}/agenda`);
    C.councilsAgendaDtoSchema.parse(agenda.json);
    const item = agenda.json.items[0];
    const detail = await call("director", "GET", `/agenda/${item.id}`);
    expect(detail.status).toBe(200);
    const parsed = C.councilsAgendaItemDetailDtoSchema.parse(detail.json);
    expect(parsed.facts?.schema).toBe("council-facts/1");
    expect(C.findNonExactNumber(parsed.facts)).toBeNull(); // aucun flottant dans l'instantané
    // l'enseignant de la classe propose ; il ne décide pas, ne résout pas
    const proposal = await call("teacher", "POST", `/agenda/${item.id}/proposals`, { kind: "APPRECIATION", body: "Élève sérieux et appliqué." });
    expect(proposal.status).toBe(201);
    C.councilsProposalDtoSchema.parse(proposal.json);
    expect((await call("teacher", "POST", `/proposals/${proposal.json.id}/accept`, {})).status).toBe(403);
    expect((await call("teacher", "POST", `/agenda/${item.id}/decisions`, { decisionTypeId: w.decisionTypes.PASSAGE, deciderParticipantId: w.director.userId, mode: "CONSENSUS" })).status).toBe(403);
    // un enseignant d'une autre classe ne voit pas la séance (404, jamais 403)
    expect((await call("outsider", "GET", `/councils/${council.id}`)).status).toBe(404);
    expect((await call("outsider", "GET", `/agenda/${item.id}`)).status).toBe(404);
    expect((await call("teacher", "GET", `/councils/${council.id}`)).status).toBe(200);
    const mine = await call("teacher", "GET", `/councils?classroomId=${w.classroomId}`);
    expect(mine.json.total).toBe(1);
    expect((await call("outsider", "GET", `/councils?classroomId=${w.classroomId}`)).json.total).toBe(0);
    // décision par le président : contrat
    const president = (await call("director", "GET", `/councils/${council.id}/participants`)).json.items.find((p: { councilFunction: string }) => p.councilFunction === "PRESIDENT");
    const decided = await call("director", "POST", `/agenda/${item.id}/decisions`, { decisionTypeId: w.decisionTypes.OTHER, deciderParticipantId: president.id, mode: "CONSENSUS", justification: "Décision de démonstration." });
    expect(decided.status).toBe(201);
    expect(C.councilsDecisionDtoSchema.parse(decided.json).recordedBy).toBe(w.director.userId);
    // PV pas encore généré : la séance n'est pas close
    expect((await call("secretary", "POST", `/councils/${council.id}/minutes`, {})).json.code).toBe("councils.invalid_state");
    expect((await call("director", "GET", `/minutes/${w.director.userId}`)).status).toBe(404);
    expect((await call("director", "GET", `/councils/${council.id}/events`)).status).toBe(200);
  });

  it("portails : le parent lit ses enfants (404 hors lien), l'élève lui-même ; un parent n'a pas le portail élève", async () => {
    const mine = await call("parent", "GET", `/children/${w.students[0]!.studentId}/decisions`);
    expect(mine.status).toBe(200);
    C.councilsFamilyDecisionsDtoSchema.parse(mine.json);
    expect((await call("otherParent", "GET", `/children/${w.students[0]!.studentId}/decisions`)).status).toBe(404);
    expect((await call("parent", "GET", `/children/${w.students[1]!.studentId}/decisions`)).status).toBe(404);
    expect((await call("teacher", "GET", `/children/${w.students[0]!.studentId}/decisions`)).status).toBe(403);
    expect((await call("pupil", "GET", "/me/decisions")).status).toBe(200);
    expect((await call("parent", "GET", "/me/decisions")).status).toBe(403);
  });

  it("features : sans `councils.orientation` les routes d'orientation sont refusées ; sans `councils.core` tout l'est", async () => {
    expect((await call("director", "GET", "/orientation-paths")).status).toBe(200);
    features.delete("councils.orientation");
    const denied = await call("director", "GET", "/orientation-paths");
    expect(denied.status).toBe(403);
    expect(denied.json.code).toBe("entitlements.feature_not_available");
    expect((await call("director", "GET", "/councils")).status).toBe(200);
    features.add("councils.orientation");
    features.delete("councils.core");
    expect((await call("director", "GET", "/councils")).status).toBe(403);
    features.add("councils.core");
  });

  it("paramètres : types de décision en données (code final validé contre le contrat de règles), cohérence imposée", async () => {
    const bad = await call("director", "PUT", "/decision-types", { code: "PASSAGE_BIZARRE", label: "Passage bizarre", family: "PASSAGE", resultsDecisionKind: "YEAR_END", resultsFinalCode: "INVENTE" });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("councils.code_not_allowed_by_contract");
    const noKind = await call("director", "PUT", "/decision-types", { code: "SANS_GENRE", label: "Sans genre", family: "PASSAGE", resultsFinalCode: "PROMOTED" });
    expect(noKind.status).toBe(400);
    const orientation = await call("director", "PUT", "/decision-types", { code: "ORIENT_BIS", label: "Orientation bis", family: "ORIENTATION" });
    expect(orientation.status).toBe(200);
    expect(orientation.json.requiresTarget).toBe(true); // imposé par la famille
    const exclusion = await call("director", "PUT", "/decision-types", { code: "EXCL_BIS", label: "Exclusion bis", family: "EXCLUSION" });
    expect(exclusion.json).toMatchObject({ needsHumanApplication: true, studentStatus: null });
    expect((await call("secretary", "PUT", "/decision-types", { code: "X", label: "x", family: "OTHER" })).status).toBe(403);
    const list = await call("teacher", "GET", "/decision-types");
    expect(list.json.items.some((t: { code: string }) => t.code === "ORIENT_BIS")).toBe(true);
    const roles = await call("director", "PUT", "/participant-roles", { code: "DEMO_ROLE", label: "Rôle de démonstration" });
    expect(roles.status).toBe(200);
    const unknownRole = await call("director", "PUT", "/council-types", { code: "ROLE_INCONNU", label: "Type", scope: "PERIOD", requiredRoleCodes: ["NOPE"] });
    expect(unknownRole.status).toBe(400);
  });

  it("orientation : aucun parcours livré ; dérogation hors parcours exige la permission sensible", async () => {
    const empty = await call("director", "GET", "/orientation-paths");
    expect(empty.json.items).toEqual([]);
    const cls = freshClassroom(w, { students: 1 });
    const body = { enrollmentId: cls.students[0]!.enrollmentId, toProgramId: w.programId, toGradeLevelId: "00000000-0000-4000-8000-0000000000bb", effectiveKind: "NEXT_YEAR", decidedVia: "DIRECTOR_ACT", actReference: "Acte 1", overrideReason: "Dérogation motivée par la situation du dossier." };
    identities.set("orienter", { ctx: w.director2.ctx, perms: ["council.orientation.manage", "council.orientation.read"] });
    expect((await call("orienter", "POST", "/series-transfers", body)).status).toBe(403);
    const ok = await call("director", "POST", "/series-transfers", body);
    expect(ok.status).toBe(201);
    C.councilsSeriesTransferDtoSchema.parse(ok.json);
    expect(ok.json.overridden).toBe(true);
  });

  it("sans état de résultats, créer une séance échoue proprement (409), jamais 500", async () => {
    w.ports.setState(w.classroomId, null, null);
    const r = await call("director", "POST", "/councils", { classroomId: w.classroomId, councilTypeId: w.types.YEAR });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("councils.results_not_ready");
  });

  it("chaque permission du manifeste protège une route (garde de route ou capacité lue par les cas d'usage) et aucune route n'exige une permission hors manifeste", () => {
    expect([...requested].filter((p) => !ALL.includes(p))).toEqual([]);
    expect(ALL.filter((p) => !requested.has(p))).toEqual([]);
  });
});
