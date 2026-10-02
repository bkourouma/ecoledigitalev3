/**
 * API HTTP /api/v1/higher/* — plugin chargé par le VRAI registre de modules avec le contrat `(app, runtime)` : routes sans
 * préfixe, `setup` à la racine, 401 sans contexte, 403 sans permission, erreurs stables, DTO conformes aux contrats Zod.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId, noopLogger, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import {
  higherAwardDtoSchema,
  higherCandidateDtoSchema,
  higherCreditSummaryDtoSchema,
  higherDiplomaDetailDtoSchema,
  higherDiplomaDtoSchema,
  higherDiplomaProgressViewDtoSchema,
  higherDocumentDetailDtoSchema,
  higherDocumentDtoSchema,
  higherIssuedDocumentDtoSchema,
  higherLedgerEntryDtoSchema,
  higherOpenResitWindowResultDtoSchema,
  higherPathwayDtoSchema,
  higherPrerequisiteCheckDtoSchema,
  higherResitWindowDtoSchema,
  higherSetPrerequisitesResultDtoSchema,
  higherSlotDtoSchema,
  higherStudentDiplomasDtoSchema,
  higherSyncReportDtoSchema,
  higherEventPayloadSchemas,
} from "@ecoledigitale/contracts/src/v2/higher";
import type { ModuleRuntime } from "../../../../platform/runtime";
import { registerModules, resetRegistryForTests } from "../../../registry";
import manifest from "../../manifest";
import { registerHigherPorts } from "../../http/plugin";
import { capitalizePeriod } from "../../application/ledger";
import { renderOfficialDocument } from "../../application/files";
import { adminRows, createHigherTestDb, describeIntegration, type HigherTestDb } from "../support/db";
import { makeWorld, scriptRules, seedSchool, ueLine, type School, type TestWorld } from "../support/world";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ALL = manifest.permissions.map((p) => p.key);
const moduleDir = join(dirname(fileURLToPath(import.meta.url)), "../..");

interface Who {
  ctx: RequestContext;
  perms: string[];
}

describeIntegration("API HTTP /api/v1/higher/* (Fastify + registre + Postgres réel)", () => {
  let db: HigherTestDb;
  let world: TestWorld;
  let school: School;
  let app: FastifyInstance;
  let features: Set<string>;
  const identities = new Map<string, Who>();
  const as = (name: string, ctx: RequestContext, perms: string[]) => void identities.set(name, { ctx, perms });

  const call = async (who: string | null, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({
      method,
      url: `/api/v1/higher${url}`,
      headers: { ...(who ? { "x-test-identity": who } : {}), ...headers },
      ...(body !== undefined ? { payload: body as never } : {}),
    });
    let json: any = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      /* corps non JSON */
    }
    return { status: res.statusCode, json };
  };
  const ok = <T>(r: { status: number; json: T }, status = 200): T => {
    expect(r.status, JSON.stringify(r.json)).toBe(status);
    return r.json;
  };

  beforeAll(async () => {
    db = await createHigherTestDb();
    world = makeWorld(db);
    scriptRules(world);
    school = await seedSchool(db, world, { students: 3 });
    features = new Set(["higher.diplomas", "higher.session2", "higher.prerequisites", "higher.attestations"]);
    as("admin", school.admin.ctx, ALL);
    as("teacher", createRequestContext({ tenantId: school.tenantId, userId: newId(), roles: ["enseignant"] }), []);
    as("pupil", school.pupil.ctx, ["higher.self.read"]);
    as("guardian", school.guardian.ctx, ["higher.child.read"]);
    const otherGuardianId = newId();
    world.ports.students.addGuardian(otherGuardianId, school.students[2]!.studentId);
    as("otherGuardian", createRequestContext({ tenantId: school.tenantId, userId: otherGuardianId, roles: ["parent"] }), ["higher.child.read"]);
    as("registrar", createRequestContext({ tenantId: school.tenantId, userId: newId(), roles: ["secretariat"] }), ["higher.diploma.read", "higher.document.read", "higher.credits.read", "higher.award.read"]);
    as("noRole", createRequestContext({ tenantId: school.tenantId, userId: newId(), roles: [] }), []);

    app = Fastify({ logger: false });
    app.decorate("v2", {} as never);
    // Authentification simulée : `request.ctx` posé en amont (iam en production). Aucun en-tête d'identité du client n'est lu par le module.
    app.addHook("onRequest", async (req) => {
      const id = req.headers["x-test-identity"];
      const who = typeof id === "string" ? identities.get(id) : undefined;
      if (who) (req as unknown as { ctx: RequestContext }).ctx = who.ctx;
    });
    const identityOf = (req: FastifyRequest): Who | undefined => {
      const id = req.headers["x-test-identity"];
      return typeof id === "string" ? identities.get(id) : undefined;
    };
    const runtime = {
      tenantDb: db.tenantDb,
      systemDb: db.systemDb,
      clock: world.clock,
      logger: noopLogger,
      manifests: [manifest],
      env: {},
      requirePermission: (permission: string) =>
        async function guard(this: FastifyInstance, req: FastifyRequest): Promise<void> {
          const who = identityOf(req);
          if (!who) throw new UnauthorizedError();
          if (!who.perms.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
        },
      auditPort: { record: async (_tx: unknown, entry: unknown) => void world.audit.entries.push({ ctx: school.admin.ctx, entry: { action: (entry as { action: string }).action, resourceType: "x", resourceId: "x" } }), recordPlatform: async () => undefined },
      entitlements: {
        reader: {},
        requireFeature: (feature: string) =>
          async function gate() {
            if (!features.has(feature)) throw new ForbiddenError("Fonctionnalité non disponible.", { code: "entitlements.feature_not_available", details: { feature } });
          },
        isFeatureEnabled: async (_c: unknown, f: string) => features.has(f),
      },
      scopeTrees: {},
      resolveContext: (req: FastifyRequest) => {
        const who = identityOf(req);
        if (!who) throw new UnauthorizedError();
        return who.ctx;
      },
    } as unknown as ModuleRuntime;

    // Les modules voisins enregistrent leurs ports (ici : mémoire) AVANT le chargement du module — ordre indifférent en production.
    registerHigherPorts(app, world.ports);
    await registerModules(app, {
      enabled: true,
      runtime,
      logger: noopLogger as never,
      importer: (path) => import(/* @vite-ignore */ path),
      discovered: [{ key: "higher", dir: moduleDir, manifestPath: join(moduleDir, "manifest.ts"), manifest, pluginPath: join(moduleDir, "http/plugin.ts"), migrationsDir: join(moduleDir, "migrations") }],
    });
    await app.ready();
  });
  afterAll(async () => {
    resetRegistryForTests();
    await app.close();
    await db.drop();
  });

  let defId: string;
  let awardId: string;
  let docId: string;

  it("401 sans contexte, 403 sans permission (l'enseignant n'a AUCUN accès), 404 inconnu ; routes sous /api/v1/higher uniquement", async () => {
    expect((await call(null, "GET", "/diplomas")).status).toBe(401);
    expect((await call(null, "GET", "/me/pathway")).status).toBe(401);
    for (const [method, url, body] of [
      ["GET", "/diplomas", undefined],
      ["POST", "/diplomas", {}],
      ["GET", `/diplomas/${newId()}/candidates`, undefined],
      ["POST", `/diplomas/${newId()}/awards`, { studentId: newId() }],
      ["POST", `/awards/${newId()}/revoke`, { reason: "motif suffisant" }],
      ["POST", `/awards/${newId()}/documents`, { kind: "DIPLOMA" }],
      ["GET", "/documents", undefined],
      ["GET", `/documents/${newId()}`, undefined],
      ["GET", `/students/${school.students[0]!.studentId}/credits`, undefined],
      ["GET", `/students/${school.students[0]!.studentId}/diplomas`, undefined],
      ["GET", "/resit-windows", undefined],
      ["GET", `/ue/${school.ues[0]!.nodeId}/prerequisites`, undefined],
      ["PUT", "/document-slots", {}],
      ["GET", "/settings", undefined],
      ["GET", "/me/credits", undefined],
      ["GET", `/children/${school.students[0]!.studentId}/credits`, undefined],
    ] as const) {
      const r = await call("teacher", method, url, body);
      expect(r.status, `${method} ${url}`).toBe(403);
    }
    const missing = await call("admin", "GET", `/diplomas/${newId()}`);
    expect(missing.json).toMatchObject({ status: 404, code: "higher.diploma_not_found" });
    expect((await app.inject({ method: "GET", url: "/api/v1/diplomas", headers: { "x-test-identity": "admin" } })).statusCode).toBe(404); // pas de double préfixe ni de route hors module
    expect((await app.inject({ method: "GET", url: "/api/v1/higher/api/v1/higher/diplomas", headers: { "x-test-identity": "admin" } })).statusCode).toBe(404);
  });

  it("valide strictement les entrées : champ inconnu, UUID invalide, forçage sans motif, JSON mal formé -> 400 stable", async () => {
    for (const [method, url, body] of [
      ["POST", "/diplomas", { code: "x" }],
      ["POST", "/diplomas/from-curriculum", { curriculumNodeId: "pas-un-uuid", gradeCode: "LICENCE" }],
      ["POST", "/diplomas/from-curriculum", { curriculumNodeId: school.cycleNodeId, gradeCode: "licence" }],
      ["PATCH", `/diplomas/${newId()}`, {}],
      ["PATCH", `/diplomas/${newId()}`, { surprise: 1 }],
      ["POST", `/diplomas/${newId()}/awards`, { studentId: newId(), force: true }],
      ["POST", `/diplomas/${newId()}/awards`, { studentId: newId(), extra: true }],
      ["POST", `/awards/${newId()}/revoke`, { reason: "court" }],
      ["POST", `/awards/${newId()}/documents`, { kind: "ATTESTATION_SUCCESS" }],
      ["POST", `/awards/${newId()}/documents`, { kind: "ATTESTATION_AUTHENTICITY", duplicate: true }],
      ["PUT", `/ue/${school.ues[0]!.nodeId}/prerequisites`, { prerequisites: [{ prerequisiteNodeId: newId(), mode: "MIN_AVERAGE" }] }],
      ["PUT", `/ue/${school.ues[0]!.nodeId}/prerequisites`, { prerequisites: [{ prerequisiteNodeId: newId(), minAverage: 10 }] }],
      ["POST", "/resit-windows", { classroomId: school.classroomId, academicPeriodId: school.periodId, opensOn: "2026-10-19", closesOn: "2026-10-05" }],
      ["POST", "/resit-windows", { classroomId: school.classroomId, academicPeriodId: school.periodId, opensOn: "2026-02-30", closesOn: "2026-03-05" }],
      ["PUT", "/document-slots", { slotKey: "SECRET", signatoryId: newId(), validFrom: "2026-01-01" }],
      ["PUT", "/settings", { creditValidityMonths: 0 }],
      ["GET", "/diplomas?status=ZOMBIE", undefined],
      ["GET", "/diplomas/pas-un-uuid", undefined],
    ] as const) {
      const r = await call("admin", method, url, body);
      expect(r.status, `${method} ${url} ${JSON.stringify(body)}`).toBe(400);
      expect(r.json).toMatchObject({ status: 400, kind: "validation" });
    }
    const malformed = await app.inject({ method: "POST", url: "/api/v1/higher/diplomas", headers: { "x-test-identity": "admin", "content-type": "application/json" }, payload: "{oops" });
    expect(malformed.statusCode).toBe(400);
  });

  it("diplômes : création depuis le curriculum, liste, détail, modification, exigences, synchronisation (DTO conformes aux contrats)", async () => {
    const created = higherDiplomaDetailDtoSchema.parse(ok(await call("admin", "POST", "/diplomas/from-curriculum", { curriculumNodeId: school.cycleNodeId, gradeCode: "LICENCE", code: "LIC-GL" }), 201));
    defId = created.diploma.id;
    expect(created).toMatchObject({ diploma: { code: "LIC-GL", uvRequired: 18, status: "ACTIVE" }, requirementsCredits: 18 });
    expect(created.requirements).toHaveLength(3);
    const dup = await call("admin", "POST", "/diplomas/from-curriculum", { curriculumNodeId: school.cycleNodeId, gradeCode: "LICENCE", code: "LIC-GL" });
    expect(dup.json).toMatchObject({ status: 409, code: "higher.diploma_duplicate_code" });

    const list = ok(await call("registrar", "GET", "/diplomas?status=ACTIVE")) as { items: unknown[] };
    expect(list.items.map((i) => higherDiplomaDtoSchema.parse(i).code)).toEqual(["LIC-GL"]);
    expect(higherDiplomaDetailDtoSchema.parse(ok(await call("registrar", "GET", `/diplomas/${defId}`))).diploma.id).toBe(defId);
    expect((await call("registrar", "POST", "/diplomas", {})).status).toBe(403); // lecture seule

    const patched = higherDiplomaDtoSchema.parse(ok(await call("admin", "PATCH", `/diplomas/${defId}`, { label: "Licence GL (v2)", autoAward: false })));
    expect(patched).toMatchObject({ label: "Licence GL (v2)", autoAward: false });
    const reqs = ok(await call("admin", "GET", `/diplomas/${defId}/requirements`)) as { items: Array<{ ueNodeId: string }> };
    expect(reqs.items).toHaveLength(3);
    const replaced = higherDiplomaDetailDtoSchema.parse(ok(await call("admin", "PUT", `/diplomas/${defId}/requirements`, { requirements: school.ues.map((u) => ({ ueNodeId: u.nodeId })) })));
    expect(replaced.requirements).toHaveLength(3);
    const foreign = await call("admin", "PUT", `/diplomas/${defId}/requirements`, { requirements: [{ ueNodeId: newId() }] });
    expect(foreign.json).toMatchObject({ status: 400, code: "higher.requirement_cross_cycle" });
    expect(higherSyncReportDtoSchema.parse(ok(await call("admin", "POST", `/diplomas/${defId}/sync`)))).toMatchObject({ added: [], removed: [], suggestedUvRequired: 18 });
    ok(await call("admin", "PATCH", `/diplomas/${defId}`, { autoAward: true }));
  });

  it("crédits, candidats, éligibilité, octroi manuel/forcé, doublon, révocation, ré-octroi", async () => {
    const [a, b] = school.students;
    world.ports.credits.setFinalLines(school.classroomId, school.periodId, [...school.ues.map((u) => ueLine(school, a!, u)), ueLine(school, b!, school.ues[0]!)]);
    unwrap(await capitalizePeriod(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
    world.ports.cycleResults.set(a!.studentId, school.cycleNodeId, { complete: true, semesters: [{ academicPeriodId: school.periodId, academicYearId: school.yearId, average: "14.5", credits: 18 }] });

    const candidates = (ok(await call("admin", "GET", `/diplomas/${defId}/candidates`)) as { items: unknown[] }).items.map((c) => higherCandidateDtoSchema.parse(c));
    expect(candidates.map((c) => [c.fullName, c.eligible, c.uvValidated])).toEqual([["Étudiant 01", true, 18], ["Étudiant 02", false, 6], ["Étudiant 03", false, 0]]);
    const progress = higherDiplomaProgressViewDtoSchema.parse(ok(await call("admin", "GET", `/diplomas/${defId}/students/${b!.studentId}/progress`)));
    expect(progress).toMatchObject({ eligibility: { eligible: false }, award: null, progress: { uvValidated: 6, percent: 33 } });

    // Octroi manuel de A ; non éligible B refusé ; forcé : 403 sans permission de forçage (identité dédiée sans `higher.award.force`).
    const awarded = higherAwardDtoSchema.parse(((ok(await call("admin", "POST", `/diplomas/${defId}/awards`, { studentId: a!.studentId }), 201)) as { award: unknown }).award);
    awardId = awarded.id;
    expect(awarded).toMatchObject({ reference: "DIP-2026-000001", awardedVia: "MANUAL", status: "OBTAINED", mentionCode: "GOOD", creditsTotal: 18 });
    const again = await call("admin", "POST", `/diplomas/${defId}/awards`, { studentId: a!.studentId });
    expect(again.json).toMatchObject({ status: 409, code: "higher.diploma_already_awarded" });
    const notEligible = await call("admin", "POST", `/diplomas/${defId}/awards`, { studentId: b!.studentId });
    expect(notEligible.json).toMatchObject({ status: 409, code: "higher.diploma_not_eligible" });
    as("awarder", school.admin.ctx, ALL.filter((p) => p !== "higher.award.force"));
    const noForce = await call("awarder", "POST", `/diplomas/${defId}/awards`, { studentId: b!.studentId, force: true, reason: "Décision exceptionnelle du jury n°7" });
    expect(noForce.json).toMatchObject({ status: 403 });
    const forced = higherAwardDtoSchema.parse(((ok(await call("admin", "POST", `/diplomas/${defId}/awards`, { studentId: b!.studentId, force: true, reason: "Décision exceptionnelle du jury n°7" }), 201)) as { award: unknown }).award);
    expect(forced).toMatchObject({ awardedVia: "FORCED", forcedReason: "Décision exceptionnelle du jury n°7", reference: "DIP-2026-000002" });

    const awarded2 = ok(await call("registrar", "GET", `/diplomas/${defId}/awarded`)) as { items: unknown[] };
    expect(awarded2.items).toHaveLength(2);
    expect((await call("registrar", "GET", `/diplomas/${defId}/awarded`)).status).toBe(200); // higher.award.read
    expect((await call("registrar", "POST", `/awards/${forced.id}/revoke`, { reason: "Motif suffisamment long" })).status).toBe(403);
    const revoked = higherAwardDtoSchema.parse(((ok(await call("admin", "POST", `/awards/${forced.id}/revoke`, { reason: "Octroi forcé annulé par la direction" })) as { award: unknown }).award));
    expect(revoked).toMatchObject({ status: "REVOKED", revokeReason: "Octroi forcé annulé par la direction" });
    const reaward = await call("admin", "POST", `/diplomas/${defId}/awards`, { studentId: b!.studentId, force: true, reason: "Nouvelle tentative de forçage ici" });
    expect(reaward.json).toMatchObject({ code: "higher.reaward_forbidden" });
    const rec = ok(await call("admin", "POST", `/diplomas/${defId}/recompute`)) as { evaluated: number };
    expect(rec.evaluated).toBe(3);

    const credits = ok(await call("registrar", "GET", `/students/${a!.studentId}/credits`)) as { summary: unknown; entries: unknown[]; debts: unknown[] };
    expect(higherCreditSummaryDtoSchema.parse(credits.summary)).toMatchObject({ totalCredits: 18, acquiredUeCount: 3 });
    expect(credits.entries.map((e) => higherLedgerEntryDtoSchema.parse(e))).toHaveLength(3);
  });

  it("documents : signataire manquant -> 409 ; émission 201, idempotente 200 ; publication ; accès étudiant / tuteur limités aux documents publiés", async () => {
    const [a, b] = school.students;
    const noSlot = await call("admin", "POST", `/awards/${awardId}/documents`, { kind: "DIPLOMA" });
    expect(noSlot.json).toMatchObject({ status: 409, code: "higher.signatory_missing" });
    for (const [slotKey, signatoryId] of [["DIPLOMA_LEFT", school.signatories.left], ["DIPLOMA_RIGHT", school.signatories.right], ["AUTHENTICITY", school.signatories.authenticity], ["ATTESTATION_SUCCESS", school.signatories.attestation]] as const) {
      higherSlotDtoSchema.parse(ok(await call("admin", "PUT", "/document-slots", { slotKey, signatoryId, validFrom: "2026-01-01" })));
    }
    expect(((ok(await call("registrar", "GET", "/document-slots")) as { items: unknown[] }).items)).toHaveLength(4);
    expect((await call("registrar", "PUT", "/document-slots", { slotKey: "DIPLOMA_LEFT", signatoryId: school.signatories.left, validFrom: "2026-02-01" })).status).toBe(403);

    const issued = higherIssuedDocumentDtoSchema.parse(ok(await call("admin", "POST", `/awards/${awardId}/documents`, { kind: "DIPLOMA" }), 201));
    docId = issued.document.id;
    expect(issued).toMatchObject({ created: true, document: { documentKind: "DIPLOMA", reference: "DIP-2026-000001", status: "ISSUED", sealed: false, publishedAt: null } });
    expect(ok(await call("admin", "POST", `/awards/${awardId}/documents`, { kind: "DIPLOMA" }))).toMatchObject({ created: false });
    const auth = higherIssuedDocumentDtoSchema.parse(ok(await call("admin", "POST", `/awards/${awardId}/documents`, { kind: "ATTESTATION_AUTHENTICITY" }), 201));
    expect(auth.document.reference).toBe("AUTH/2026/001");

    // Avant publication : l'étudiant ne voit rien, ne lit pas le document ; le personnel oui.
    expect(((ok(await call("pupil", "GET", "/me/documents")) as { items: unknown[] }).items)).toHaveLength(0);
    expect((await call("pupil", "GET", `/documents/${docId}`)).status).toBe(403);
    expect((await call("guardian", "GET", `/documents/${docId}`)).status).toBe(403);
    higherDocumentDetailDtoSchema.parse(ok(await call("registrar", "GET", `/documents/${docId}`)));
    const list = ok(await call("registrar", "GET", "/documents?kind=DIPLOMA")) as { items: unknown[] };
    expect(list.items.map((d) => higherDocumentDtoSchema.parse(d).id)).toEqual([docId]);

    expect((await call("registrar", "POST", `/documents/${docId}/publish`)).status).toBe(403);
    ok(await call("admin", "POST", `/documents/${docId}/publish`));
    expect(((ok(await call("pupil", "GET", "/me/documents")) as { items: Array<{ id: string }> }).items.map((d) => d.id))).toEqual([docId]);
    expect(higherDocumentDetailDtoSchema.parse(ok(await call("pupil", "GET", `/documents/${docId}`))).snapshot).toMatchObject({ schema: "diploma/1" });
    expect(higherDocumentDetailDtoSchema.parse(ok(await call("guardian", "GET", `/documents/${docId}`))).id).toBe(docId);
    expect(((ok(await call("guardian", "GET", `/children/${a!.studentId}/documents`)) as { items: unknown[] }).items)).toHaveLength(1);
    // Un tuteur lié à un AUTRE étudiant, et un étudiant tiers, n'ont aucun accès.
    expect((await call("otherGuardian", "GET", `/documents/${docId}`)).status).toBe(403);
    expect((await call("otherGuardian", "GET", `/children/${a!.studentId}/documents`)).status).toBe(403);
    expect((await call("guardian", "GET", `/children/${b!.studentId}/credits`)).status).toBe(403);
    expect((await call("noRole", "GET", `/documents/${docId}`)).status).toBe(403);
  });

  it("PDF : état du rendu (202) puis URL signée (200) ; même contrôle d'accès que le document ; révoqué : 409 ; reprise réservée à l'émission", async () => {
    // Pas encore rendu : le personnel lit l'état (202), personne d'autre n'y accède sans droit.
    const pending = await call("registrar", "GET", `/documents/${docId}/pdf`);
    expect(pending.status).toBe(202);
    expect(pending.json).toEqual({ status: "PENDING" });
    expect((await call("noRole", "GET", `/documents/${docId}/pdf`)).status).toBe(403);
    expect((await call("otherGuardian", "GET", `/documents/${docId}/pdf`)).status).toBe(403);
    expect((await call("teacher", "GET", `/documents/${docId}/pdf`)).status).toBe(403);
    expect((await call(null, "GET", `/documents/${docId}/pdf`)).status).toBe(401);
    // Reprise : réservée à `higher.document.issue` ; la demande est publiée au worker.
    expect((await call("registrar", "POST", `/documents/${docId}/render`)).status).toBe(403);
    expect(ok(await call("admin", "POST", `/documents/${docId}/render`), 202)).toMatchObject({ id: docId, renderStatus: "PENDING" });
    const requested = await adminRows<{ payload: { documentId: string } }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'higher.document.render_requested'", [school.tenantId]);
    expect(requested.map((r) => r.payload.documentId)).toEqual([docId]);
    expect(higherEventPayloadSchemas["higher.document.render_requested"].safeParse(requested[0]!.payload).success).toBe(true);

    // Le worker scelle et rend (ports : mémoire) ; l'URL est signée et à durée courte.
    const rendered = unwrap(await renderOfficialDocument(world.deps, school.admin.ctx, docId));
    expect(rendered).toMatchObject({ renderStatus: "RENDERED", signingKeyId: "test-key-0001" });
    const ready = await call("registrar", "GET", `/documents/${docId}/pdf`);
    expect(ready.status).toBe(200);
    expect(ready.json).toMatchObject({ status: "READY", contentType: "application/pdf", expiresInSec: 120, fileName: "DIP-2026-000001.pdf" });
    expect(ready.json.url).toMatch(/^https:\/\//);
    expect(ready.json.url).not.toContain("tenants/");
    expect(ready.json.pdfHash).toMatch(/^[0-9a-f]{64}$/);
    // Étudiant et tuteur lié : leur document publié ; un tiers non.
    expect((await call("pupil", "GET", `/documents/${docId}/pdf`)).status).toBe(200);
    expect((await call("guardian", "GET", `/documents/${docId}/pdf`)).status).toBe(200);
    expect((await call("otherGuardian", "GET", `/documents/${docId}/pdf`)).status).toBe(403);
    // L'émission d'une URL est auditée.
    expect(world.audit.entries.filter((e) => e.entry.action === "higher.document.downloaded").length).toBeGreaterThanOrEqual(3);
  });

  it("étudiant et tuteur : leurs crédits, diplômes et parcours uniquement ; jamais ceux d'un autre", async () => {
    const [a, b] = school.students;
    expect(higherCreditSummaryDtoSchema.parse((ok(await call("pupil", "GET", "/me/credits")) as { summary: unknown }).summary).totalCredits).toBe(18);
    expect(higherStudentDiplomasDtoSchema.parse(ok(await call("pupil", "GET", "/me/diplomas"))).awards).toHaveLength(1); // l'octroi (révoqué plus tard) de l'étudiant 01 seulement
    higherPathwayDtoSchema.parse(ok(await call("pupil", "GET", "/me/pathway")));
    expect(higherPathwayDtoSchema.parse(ok(await call("guardian", "GET", `/children/${a!.studentId}/pathway`))).summary.totalCredits).toBe(18);
    expect((await call("pupil", "GET", `/students/${b!.studentId}/credits`)).status).toBe(403); // pas celui d'un camarade
    expect((await call("pupil", "GET", `/students/${a!.studentId}/credits`)).status).toBe(200); // le sien, via higher.self.read
    expect((await call("guardian", "GET", `/students/${a!.studentId}/diplomas`)).status).toBe(200); // son enfant
    expect((await call("guardian", "GET", `/students/${b!.studentId}/diplomas`)).status).toBe(403);
    expect((await call("otherGuardian", "GET", `/students/${school.students[2]!.studentId}/credits`)).status).toBe(200);
    expect((await call("guardian", "GET", "/me/credits")).status).toBe(403); // pas higher.self.read
    expect((await call("pupil", "GET", `/children/${a!.studentId}/credits`)).status).toBe(403); // pas higher.child.read
  });

  it("prérequis (feature higher.prerequisites) : définition, avertissements, vérification serveur", async () => {
    const [, b] = school.students;
    const [u1, u2] = school.ues;
    const set = higherSetPrerequisitesResultDtoSchema.parse(ok(await call("admin", "PUT", `/ue/${u2!.nodeId}/prerequisites`, { prerequisites: [{ prerequisiteNodeId: u1!.nodeId }] })));
    expect(set.prerequisites).toHaveLength(1);
    const loop = await call("admin", "PUT", `/ue/${u1!.nodeId}/prerequisites`, { prerequisites: [{ prerequisiteNodeId: u2!.nodeId }] });
    expect(loop.json).toMatchObject({ status: 400, code: "higher.prerequisite_cycle" });
    expect(((ok(await call("registrar", "GET", `/ue/${u2!.nodeId}/prerequisites`)) as { items: unknown[] }).items)).toHaveLength(1);
    const check = higherPrerequisiteCheckDtoSchema.parse(ok(await call("registrar", "GET", `/students/${school.students[2]!.studentId}/prerequisites-check?nodeId=${u2!.nodeId}`)));
    expect(check).toMatchObject({ satisfied: false, missing: [{ reason: "NOT_ACQUIRED" }] });
    expect(higherPrerequisiteCheckDtoSchema.parse(ok(await call("registrar", "GET", `/students/${b!.studentId}/prerequisites-check?nodeId=${u2!.nodeId}`))).satisfied).toBe(true);
    features.delete("higher.prerequisites");
    const off = await call("admin", "GET", `/ue/${u2!.nodeId}/prerequisites`);
    expect(off.json).toMatchObject({ status: 403, code: "entitlements.feature_not_available" });
    features.add("higher.prerequisites");
  });

  it("rattrapage (feature higher.session2) : candidats, ouverture 201, doublon 409, fermeture, vues étudiant", async () => {
    const st = school.students[2]!;
    world.ports.credits.setResitCandidates(school.classroomId, school.period2Id, {
      stateId: newId(),
      candidates: [{ enrollmentId: st.enrollmentId, studentId: st.studentId, ecueNodeId: newId(), ueNodeId: school.ues[1]!.nodeId, session1Average: "7.25" }],
    });
    const cands = ok(await call("admin", "GET", `/resit-candidates?classroomId=${school.classroomId}&periodId=${school.period2Id}`)) as { candidates: unknown[] };
    expect(cands.candidates).toHaveLength(1);
    const body = { classroomId: school.classroomId, academicPeriodId: school.period2Id, opensOn: "2026-10-05", closesOn: "2026-10-19" };
    const opened = higherOpenResitWindowResultDtoSchema.parse(ok(await call("admin", "POST", "/resit-windows", body), 201));
    expect(opened.registrations).toHaveLength(1);
    expect((await call("admin", "POST", "/resit-windows", body)).json).toMatchObject({ status: 409, code: "higher.resit_window_open_exists" });
    expect(((ok(await call("admin", "GET", "/resit-windows?status=OPEN")) as { items: unknown[] }).items.map((w) => higherResitWindowDtoSchema.parse(w).id))).toEqual([opened.window.id]);
    expect(ok(await call("admin", "GET", `/resit-windows/${opened.window.id}`))).toMatchObject({ registrations: [{ studentId: st.studentId }] });
    expect((await call("guardian", "GET", `/children/${school.students[0]!.studentId}/resits`)).status).toBe(200);
    expect(((ok(await call("otherGuardian", "GET", `/children/${st.studentId}/resits`)) as { items: Array<{ phase: string }> }).items[0]?.phase)).toBe("TO_RETAKE");
    expect(higherResitWindowDtoSchema.parse(ok(await call("admin", "POST", `/resit-windows/${opened.window.id}/close`))).status).toBe("CLOSED");
    features.delete("higher.session2");
    expect((await call("admin", "GET", "/resit-windows")).json).toMatchObject({ code: "entitlements.feature_not_available" });
    features.add("higher.session2");
  });

  it("attestation de réussite (feature higher.attestations) et réglages", async () => {
    const a = school.students[0]!;
    const roster = (ok(await call("registrar", "GET", `/attestations/roster?programNodeId=${school.programNodeId}`)) as { items: Array<{ studentId: string; eligible: boolean }> }).items;
    expect(roster.find((r) => r.studentId === a.studentId)?.eligible).toBe(true);
    expect(roster.find((r) => r.studentId === school.students[1]!.studentId)?.eligible).toBe(false);
    const refused = await call("admin", "POST", "/attestations", { studentId: school.students[1]!.studentId, programNodeId: school.programNodeId });
    expect(refused.json).toMatchObject({ status: 409, code: "higher.attestation_not_eligible" });
    const issued = higherIssuedDocumentDtoSchema.parse(ok(await call("admin", "POST", "/attestations", { studentId: a.studentId, programNodeId: school.programNodeId }), 201));
    expect(issued.document).toMatchObject({ documentKind: "ATTESTATION_SUCCESS", reference: "ATT-2026-000001" });
    expect(ok(await call("admin", "POST", "/attestations", { studentId: a.studentId, programNodeId: school.programNodeId }))).toMatchObject({ created: false });
    const revoked = await call("admin", "POST", `/documents/${issued.document.id}/revoke`, { reason: "Erreur d'identité de l'étudiant" });
    expect(revoked.json).toMatchObject({ status: "REVOKED" });
    features.delete("higher.attestations");
    expect((await call("admin", "GET", `/attestations/roster?programNodeId=${school.programNodeId}`)).json).toMatchObject({ code: "entitlements.feature_not_available" });
    features.add("higher.attestations");

    expect(ok(await call("admin", "GET", "/settings"))).toEqual({ creditValidityMonths: null });
    expect(ok(await call("admin", "PUT", "/settings", { creditValidityMonths: 36 }))).toEqual({ creditValidityMonths: 36 });
    expect((await call("registrar", "GET", "/settings")).status).toBe(403);
  });

  it("révocation d'un octroi par l'API : le diplôme et ses documents passent « révoqués » ; suppression de la définition refusée", async () => {
    ok(await call("admin", "POST", `/awards/${awardId}/revoke`, { reason: "Fraude avérée sur le mémoire" }));
    const doc = higherDocumentDetailDtoSchema.parse(ok(await call("admin", "GET", `/documents/${docId}`)));
    expect(doc).toMatchObject({ status: "REVOKED", revokeReason: "Fraude avérée sur le mémoire" });
    expect((await call("admin", "POST", `/awards/${awardId}/documents`, { kind: "DIPLOMA", duplicate: true })).json).toMatchObject({ status: 409, code: "higher.award_revoked" });
    expect((await call("admin", "DELETE", `/diplomas/${defId}`)).json).toMatchObject({ status: 409, code: "higher.diploma_has_awards" });
  });

  it("les événements d'outbox respectent les schémas Zod du contrat (payload JSON versionné)", async () => {
    const rows = await adminRows<{ type: string; payload: unknown }>(db, "SELECT type, payload FROM kernel.domain_events WHERE tenant_id = $1 AND type LIKE 'higher.%'", [school.tenantId]);
    const seen = new Set(rows.map((r) => r.type));
    for (const t of ["higher.credits.capitalized", "higher.diploma.awarded", "higher.diploma.revoked", "higher.document.issued", "higher.resit.window_opened", "higher.resit.registered", "higher.resit.window_closed"]) expect(seen, t).toContain(t);
    for (const r of rows) {
      const schema = higherEventPayloadSchemas[r.type as keyof typeof higherEventPayloadSchemas];
      expect(schema, r.type).toBeDefined();
      expect(() => schema.parse(r.payload), r.type).not.toThrow();
    }
    const audited = new Set(world.audit.actions());
    expect(audited).toContain("higher.award.created");
    expect(audited).toContain("higher.award.forced");
    expect(audited).toContain("higher.award.revoked");
  });
});
