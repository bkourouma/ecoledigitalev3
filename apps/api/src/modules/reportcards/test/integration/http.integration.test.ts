import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import {
  reportcardsBatchDtoSchema,
  reportcardsBrandingDtoSchema,
  reportcardsDownloadDtoSchema,
  reportcardsFileVerificationDtoSchema,
  reportcardsPreflightDtoSchema,
  reportcardsPublicKeysDtoSchema,
  reportcardsPublicVerificationDtoSchema,
  reportcardsReportCardDetailDtoSchema,
  reportcardsReportCardPageDtoSchema,
  reportcardsSettingsDtoSchema,
  reportcardsSignatoryDtoSchema,
  reportcardsTemplateConfigDtoSchema,
  reportcardsTemplateDtoSchema,
} from "@ecoledigitale/contracts/src/v2/reportcards";
import { createBatch } from "../../application/issue";
import { renderReportCard } from "../../application/render";
import { ensureSigningKeyRegistered } from "../../application/platform";
import manifest from "../../manifest";
import { ALL_PLATFORM_TEMPLATES } from "../../templates/builtin";
import { VERIFY_RATE_RULE, reportcardsPlugin, registerPublicRoutes } from "../../http/plugin";
import { PNG_1X1, makeWorld, newActor, seedSchool, type School, type TestWorld } from "../support/world";
import { adminRows, createReportcardsTestDb, describeIntegration, type ReportcardsTestDb } from "../support/db";
import { InMemoryRateLimiter } from "../support/rate-limiter";
import { compatRouterOptions } from "../../../../platform/http-compat";

const ALL = manifest.permissions.map((p) => p.key);
const FAMILY_SELF = ["reportcard.self.read"];
const FAMILY_CHILD = ["reportcard.child.read"];

interface Who {
  ctx: RequestContext;
  perms: string[];
}

describeIntegration("API HTTP /api/v1/reportcards/* (Fastify + Postgres réel)", () => {
  let db: ReportcardsTestDb;
  let world: TestWorld;
  let school: School;
  let app: FastifyInstance;
  let features: Set<string>;
  let superAdmins: Set<string>;
  const identities = new Map<string, Who>();
  const limiter = new InMemoryRateLimiter();

  const as = (name: string, ctx: RequestContext, perms: string[]): string => {
    identities.set(name, { ctx, perms });
    return name;
  };
  let director: string;
  let teacher: string;
  let pupil: string;
  let parent: string;
  let otherParent: string;
  let outsider: string;
  let operator = "super-admin-token";

  const call = async (who: string | null, method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: unknown, headers: Record<string, string> = {}, prefix = "/api/v1/reportcards") => {
    const res = await app.inject({
      method,
      url: `${prefix}${url}`,
      headers: { ...(who ? { "x-test-identity": who } : {}), ...headers },
      ...(body !== undefined ? (Buffer.isBuffer(body) ? { payload: body } : { payload: body as never }) : {}),
    });
    let json: any = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      /* corps non JSON */
    }
    return { status: res.statusCode, json, body: res.body, headers: res.headers };
  };
  const ok = <T>(r: { status: number; json: T }, status = 200): T => {
    expect(r.status, JSON.stringify(r.json)).toBe(status);
    return r.json;
  };

  let cardIds: string[];
  let batchId: string;

  beforeAll(async () => {
    db = await createReportcardsTestDb();
    world = makeWorld(db);
    school = await seedSchool(world, await db.createTenant(), { students: 3 });
    features = new Set(["reportcard.transcript", "reportcard.block-unpaid", "reportcard.public-verification"]);
    superAdmins = new Set(["super-admin-token"]);
    director = as("director", school.admin.ctx, ALL);
    teacher = as("teacher", newActor(school.tenantId).ctx, ["reportcard.read"]);
    const pupilActor = newActor(school.tenantId);
    pupil = as("pupil", pupilActor.ctx, FAMILY_SELF);
    const parentActor = newActor(school.tenantId);
    parent = as("parent", parentActor.ctx, FAMILY_CHILD);
    const otherParentActor = newActor(school.tenantId);
    otherParent = as("otherParent", otherParentActor.ctx, FAMILY_CHILD);
    outsider = as("outsider", createRequestContext({ tenantId: school.tenantId, userId: newId(), roles: [] }), []);
    world.guardianship.studentOfUser.set(pupilActor.userId, school.students[0]!.studentId);
    world.guardianship.link(parentActor.userId, school.students[0]!.studentId);
    world.guardianship.link(otherParentActor.userId, school.students[1]!.studentId);

    // Même configuration de routeur que le serveur réel : un code trop long reste un 404 uniforme (platform/http-compat.ts).
    app = Fastify({ logger: false, routerOptions: compatRouterOptions() });
    app.addHook("onRequest", async (req) => {
      const id = req.headers["x-test-identity"];
      const who = typeof id === "string" ? identities.get(id) : undefined;
      if (who) (req as unknown as { ctx: RequestContext }).ctx = who.ctx;
    });
    const requirePermission = (permission: string) =>
      async function guard(this: FastifyInstance, req: FastifyRequest): Promise<void> {
        const id = req.headers["x-test-identity"];
        const who = typeof id === "string" ? identities.get(id) : undefined;
        if (!who) throw new UnauthorizedError();
        if (!who.perms.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      };
    await app.register(reportcardsPlugin, {
      deps: world.deps,
      requirePermission,
      requireFeature: (feature: string) =>
        async function gate() {
          if (!features.has(feature)) throw new ForbiddenError("Fonctionnalité non disponible.", { code: "entitlements.feature_not_available", details: { feature } });
        },
      isFeatureEnabled: async (_ctx: RequestContext, feature: string) => features.has(feature),
      rateLimiter: limiter,
      authorizeSuperAdmin: async (req: FastifyRequest) => {
        const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
        if (!superAdmins.has(token)) throw new UnauthorizedError("Authentification opérateur requise.");
        return { actorId: newId() };
      },
      prefix: "/api/v1/reportcards",
    } as never);
    await registerPublicRoutes(app, { deps: world.deps, rateLimiter: new InMemoryRateLimiter(), prefix: "/api/v1/public", wellKnown: true });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it("401 sans contexte, 403 sans permission ; l'identité vient du contexte et JAMAIS d'un en-tête client", async () => {
    expect((await call(null, "GET", "/report-cards")).status).toBe(401);
    expect((await call(outsider, "GET", "/report-cards")).status).toBe(403);
    expect((await call(teacher, "POST", "/batches", {})).status).toBe(403);
    expect((await call(pupil, "GET", "/report-cards")).status).toBe(403);
    expect((await call(director, "GET", "/report-cards", undefined, { "x-user-id": newId(), "x-tenant-id": newId() })).status).toBe(200);
    const forbidden = await call(outsider, "GET", "/report-cards");
    expect(forbidden.json).toMatchObject({ status: 403, kind: "forbidden" });
  });

  describe("contrôle préalable, lot, détail", () => {
    it("GET /preflight puis POST /batches (202) ; rejouer = 200 sans doublon ; corps invalide = 400 structuré", async () => {
      const pre = ok(await call(director, "GET", `/preflight?classroomId=${school.classroomId}&academicPeriodId=${school.periodId}`));
      expect(reportcardsPreflightDtoSchema.safeParse(pre).success).toBe(true);
      expect(pre).toMatchObject({ ok: true, enrollments: { total: 3, eligible: 3, excluded: 0 } });
      const created = await call(director, "POST", "/batches", { classroomId: school.classroomId, academicPeriodId: school.periodId });
      const batch = ok(created, 202);
      expect(reportcardsBatchDtoSchema.safeParse(batch).success).toBe(true);
      expect(batch).toMatchObject({ issued: 3, status: "RENDERING" });
      batchId = batch.id;
      const replay = await call(director, "POST", "/batches", { classroomId: school.classroomId, academicPeriodId: school.periodId });
      expect(replay.status).toBe(200);
      expect(replay.json.id).toBe(batchId);
      expect(ok(await call(director, "GET", `/batches/${batchId}`)).items).toHaveLength(3);
      const bad = await call(director, "POST", "/batches", { classroomId: "pas-un-uuid" });
      expect(bad.status).toBe(400);
      expect(bad.json).toMatchObject({ code: "VALIDATION_FAILED", kind: "validation" });
      expect(bad.json.issues.length).toBeGreaterThan(0);
      expect((await call(director, "GET", `/batches/${newId()}`)).status).toBe(404);
    });

    it("préflight bloquant : 409 `reportcards.preflight_failed` avec la liste des manques", async () => {
      const bare = await seedSchool(world, await db.createTenant(), { configured: false });
      const ctxName = as("bareDirector", bare.admin.ctx, ALL);
      const r = await call(ctxName, "POST", "/batches", { classroomId: bare.classroomId, academicPeriodId: bare.periodId });
      expect(r.status).toBe(409);
      expect(r.json.code).toBe("reportcards.preflight_failed");
      expect(r.json.details.issues.map((i: any) => i.code)).toEqual(expect.arrayContaining(["reportcards.branding_missing", "reportcards.template_config_missing"]));
    });

    it("liste filtrée + détail (snapshot sans trace) + trace (permission distincte) conformes aux contrats", async () => {
      const list = ok(await call(director, "GET", `/report-cards?classroomId=${school.classroomId}&limit=2`));
      expect(reportcardsReportCardPageDtoSchema.safeParse(list).success).toBe(true);
      expect(list.items).toHaveLength(2);
      expect(list.nextCursor).toBeTruthy();
      const page2 = ok(await call(director, "GET", `/report-cards?classroomId=${school.classroomId}&limit=2&cursor=${encodeURIComponent(list.nextCursor)}`));
      expect(page2.items).toHaveLength(1);
      cardIds = [...list.items, ...page2.items].map((i: any) => i.id);
      expect(new Set(cardIds).size).toBe(3);
      const detail = ok(await call(director, "GET", `/report-cards/${cardIds[0]}`));
      expect(reportcardsReportCardDetailDtoSchema.safeParse(detail).success).toBe(true);
      expect(JSON.stringify(detail)).not.toContain("period_average");
      // La trace exige `reportcard.explain` : le « teacher » ne l'a pas.
      expect((await call(teacher, "GET", `/report-cards/${cardIds[0]}/explain`)).status).toBe(403);
      const explain = ok(await call(director, "GET", `/report-cards/${cardIds[0]}/explain`));
      expect(explain.explain.length).toBeGreaterThan(0);
      expect(ok(await call(teacher, "GET", `/report-cards?status=ISSUED&live=true`)).items.length).toBeGreaterThan(0);
      expect((await call(director, "GET", `/report-cards/${newId()}`)).status).toBe(404);
      expect((await call(director, "GET", `/report-cards?limit=500`)).status).toBe(400);
    });
  });

  describe("rendu, publication, téléchargement", () => {
    it("POST /report-cards/:id/render (reprise) -> 202 ; rendu exécuté par le worker (ici : directement) ; publication ensuite", async () => {
      const r = await call(director, "POST", `/report-cards/${cardIds[0]}/render`);
      expect(r.status).toBe(202);
      for (const id of cardIds) unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: id }));
      expect(ok(await call(director, "GET", `/report-cards/${cardIds[0]}`)).renderStatus).toBe("RENDERED");
    });

    it("publication : permission `reportcard.publish` ; l'élève voit alors SON bulletin, pas ceux des autres", async () => {
      const own = school.students[0]!.studentId;
      const cardOfPupil = ok(await call(director, "GET", `/report-cards?studentId=${own}`)).items[0].id as string;
      const cardOfOther = ok(await call(director, "GET", `/report-cards?studentId=${school.students[1]!.studentId}`)).items[0].id as string;
      expect((await call(teacher, "POST", `/report-cards/${cardOfPupil}/publish`)).status).toBe(403);
      ok(await call(director, "POST", `/report-cards/${cardOfPupil}/publish`));
      ok(await call(director, "POST", `/report-cards/${cardOfOther}/publish`));

      // Élève : « mes bulletins » = le sien uniquement.
      const mine = ok(await call(pupil, "GET", "/me/report-cards"));
      expect(mine.items.map((c: any) => c.id)).toEqual([cardOfPupil]);
      // Téléchargement : le sien oui (URL signée courte) ; celui d'un autre = 404 ; le non publié = 403.
      const dl = ok(await call(pupil, "GET", `/report-cards/${cardOfPupil}/pdf`));
      expect(reportcardsDownloadDtoSchema.safeParse(dl).success).toBe(true);
      expect(dl.contentType).toBe("application/pdf");
      expect(world.storage.verifySignedUrl(dl.url)).toMatchObject({ ok: true });
      expect((await call(pupil, "GET", `/report-cards/${cardOfOther}/pdf`)).status).toBe(404);
      const unpublished = cardIds.find((id) => id !== cardOfPupil && id !== cardOfOther)!;
      expect((await call(director, "GET", `/report-cards/${unpublished}/pdf`)).status).toBe(200); // gestion : ok
      // Parent lié : l'enfant 0 oui, jamais l'enfant 1 ; parent de l'enfant 1 : seulement le sien.
      expect((await call(parent, "GET", `/report-cards/${cardOfPupil}/pdf`)).status).toBe(200);
      expect((await call(parent, "GET", `/report-cards/${cardOfOther}/pdf`)).status).toBe(404);
      expect((await call(otherParent, "GET", `/report-cards/${cardOfPupil}/pdf`)).status).toBe(404);
      expect(ok(await call(parent, "GET", "/me/report-cards")).items.map((c: any) => c.id)).toEqual([cardOfPupil]);
      expect(ok(await call(parent, "GET", `/children/${own}/report-cards`)).items).toHaveLength(1);
      expect((await call(otherParent, "GET", `/children/${own}/report-cards`)).status).toBe(404);
      expect((await call(outsider, "GET", `/report-cards/${cardOfPupil}/pdf`)).status).toBe(403);
      // Retrait : disparaît pour la famille.
      ok(await call(director, "POST", `/report-cards/${cardOfPupil}/withdraw`));
      expect(ok(await call(pupil, "GET", "/me/report-cards")).items).toHaveLength(0);
      expect((await call(pupil, "GET", `/report-cards/${cardOfPupil}/pdf`)).status).toBe(403);
    });

    it("publication par lot POST /publish ; corps incomplet = 400", async () => {
      expect((await call(director, "POST", "/publish", {})).status).toBe(400);
      const r = ok(await call(director, "POST", "/publish", { batchId }));
      expect(r.published + r.alreadyPublished).toBe(3);
    });

    it("révocation : `reportcard.revoke` + motif ≥ 5 caractères ; la gestion non habilitée est refusée", async () => {
      const id = cardIds[2]!;
      expect((await call(teacher, "POST", `/report-cards/${id}/revoke`, { reason: "Erreur d'identité" })).status).toBe(403);
      expect((await call(director, "POST", `/report-cards/${id}/revoke`, { reason: "x" })).status).toBe(400);
      expect((await call(director, "POST", `/report-cards/${id}/revoke`, {})).status).toBe(400);
      expect(ok(await call(director, "POST", `/report-cards/${id}/revoke`, { reason: "Erreur d'identité" })).status).toBe("REVOKED");
      expect((await call(director, "POST", `/report-cards/${id}/revoke`, { reason: "Encore une fois" })).status).toBe(409);
    });

    it("réémission : motif obligatoire, 201, période doit être clôturée", async () => {
      const id = cardIds[0]!;
      expect((await call(director, "POST", `/report-cards/${id}/reissue`, {})).status).toBe(400);
      const r = await call(director, "POST", `/report-cards/${id}/reissue`, { reason: "Correction du coefficient" });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(r.json).toMatchObject({ version: 2, supersedesId: id, status: "ISSUED" });
    });

    it("PDF combiné de classe : 409 tant qu'il n'est pas prêt", async () => {
      expect((await call(director, "GET", `/classrooms/${school.classroomId}/periods/${school.periodId}/pdf`)).status).toBe(409);
    });

    it("POST /batches/:id/retry -> 202", async () => {
      expect((await call(director, "POST", `/batches/${batchId}/retry`)).status).toBe(202);
    });
  });

  describe("relevé cumulé (feature)", () => {
    it("feature `reportcard.transcript` désactivée : 403 `entitlements.feature_not_available`", async () => {
      features.delete("reportcard.transcript");
      const r = await call(director, "POST", "/transcripts", { studentId: school.students[0]!.studentId });
      expect(r.status).toBe(403);
      expect(r.json.code).toBe("entitlements.feature_not_available");
      features.add("reportcard.transcript");
      expect((await call(director, "POST", "/transcripts", { studentId: school.students[0]!.studentId })).status).toBe(409); // aucune donnée cumulée : TRANSCRIPT_EMPTY
    });
  });

  describe("identité, signataires, modèles, réglages", () => {
    it("PUT /branding : nouvelle version ; GET courant et historique ; fichier absent du stockage refusé", async () => {
      const key = `reportcards/${school.tenantId}/assets/logo/${newId()}.png`;
      const missing = await call(director, "PUT", "/branding", { legalName: "École X", logoObjectKey: key });
      expect(missing.status).toBe(400);
      expect(missing.json.code).toBe("reportcards.asset_missing");
      await world.storage.put(key, PNG_1X1, { contentType: "image/png" });
      const saved = ok(await call(director, "PUT", "/branding", { legalName: "École X", headerLeft: ["Ligne 1"], logoObjectKey: key, primaryColor: "#112233" }));
      expect(reportcardsBrandingDtoSchema.safeParse(saved).success).toBe(true);
      expect(saved).toMatchObject({ version: 2, isCurrent: true, legalName: "École X" });
      expect((await call(director, "PUT", "/branding", { legalName: "" })).status).toBe(400);
      expect((await call(director, "PUT", "/branding", { legalName: "X", primaryColor: "rouge" })).status).toBe(400);
      expect((await call(director, "PUT", "/branding", { legalName: "X", unknownField: 1 })).status).toBe(400);
      const history = ok(await call(director, "GET", "/branding?history=true"));
      expect(history.items.map((b: any) => b.version)).toEqual([2, 1]);
      expect((await call(teacher, "PUT", "/branding", { legalName: "X" })).status).toBe(403);
    });

    it("dépôt d'image par URL signée (logo) : PUT sur l'URL puis référence ; SVG déguisé refusé par le contrôle des octets", async () => {
      const up = await call(director, "POST", "/branding/assets", { kind: "logo", contentType: "image/png" });
      expect(up.status, JSON.stringify(up.json)).toBe(201);
      expect(up.json.objectKey).toMatch(new RegExp(`^reportcards/${school.tenantId}/assets/logo/[0-9a-f-]+\\.png$`));
      expect(up.json.method).toBe("PUT");
      expect(world.storage.acceptUpload(up.json.uploadUrl, PNG_1X1, "image/png")).toBe(true);
      expect(ok(await call(director, "PUT", "/branding", { legalName: "École Y", logoObjectKey: up.json.objectKey })).logoObjectKey).toBe(up.json.objectKey);
      const evil = await call(director, "POST", "/branding/assets", { kind: "emblem", contentType: "image/png" });
      world.storage.acceptUpload(evil.json.uploadUrl, new TextEncoder().encode("<svg onload='alert(1)'/>"), "image/png");
      const refused = await call(director, "PUT", "/branding", { legalName: "École Y", emblemObjectKey: evil.json.objectKey });
      expect(refused.status).toBe(400);
      expect((await call(director, "POST", "/branding/assets", { kind: "logo", contentType: "image/svg+xml" })).status).toBe(400);
      expect((await call(outsider, "POST", "/branding/assets", { kind: "logo", contentType: "image/png" })).status).toBe(403);
    });

    it("signataires : création (201), liste, désactivation (jamais supprimé), 404, validation", async () => {
      const created = await call(director, "POST", "/signatories", { fullName: "Personne Fictive Deux", title: "Responsable", validFrom: "2026-01-01" });
      expect(created.status).toBe(201);
      expect(reportcardsSignatoryDtoSchema.safeParse(created.json).success).toBe(true);
      expect((await call(director, "POST", "/signatories", { fullName: "A" })).status).toBe(400);
      expect((await call(director, "POST", "/signatories", { fullName: "Valide", validFrom: "2026-05-01", validTo: "2026-01-01" })).status).toBe(400);
      const patched = ok(await call(director, "PATCH", `/signatories/${created.json.id}`, { active: false }));
      expect(patched.active).toBe(false);
      expect((await call(director, "PATCH", `/signatories/${newId()}`, { active: false })).status).toBe(404);
      expect(ok(await call(director, "GET", "/signatories")).items.length).toBeGreaterThanOrEqual(2);
      expect((await call(teacher, "GET", "/signatories")).status).toBe(403);
    });

    it("modèles : catalogue publié, configuration validée par le schéma du gabarit, aperçu sur données FICTIVES", async () => {
      const templates = ok(await call(director, "GET", "/templates"));
      expect(templates.items.map((t: any) => t.key).sort()).toEqual(ALL_PLATFORM_TEMPLATES.map((t) => t.key).sort());
      for (const t of templates.items) expect(reportcardsTemplateDtoSchema.safeParse(t).success).toBe(true);
      const sig = ok(await call(director, "GET", "/signatories")).items.find((s: any) => s.active).id;
      const cfg = ok(await call(director, "PUT", "/template-configs", { documentKind: "REPORT_CARD", pack: "SECONDARY", templateKey: "secondary-bulletin", options: { showRank: false, watermark: "COPIE" }, signatureAssignments: [{ slot: "director", signatoryId: sig }] }));
      expect(reportcardsTemplateConfigDtoSchema.safeParse(cfg).success).toBe(true);
      expect(cfg).toMatchObject({ configVersion: 2, isCurrent: true, options: { showRank: false, watermark: "COPIE", showClassAverage: false } });
      expect((await call(director, "PUT", "/template-configs", { documentKind: "REPORT_CARD", pack: "SECONDARY", templateKey: "secondary-bulletin", options: { inconnue: 1 } })).status).toBe(400);
      expect((await call(director, "PUT", "/template-configs", { documentKind: "REPORT_CARD", pack: "SECONDARY", templateKey: "secondary-bulletin", options: { watermark: "<script>" } })).status).toBe(400);
      expect((await call(director, "PUT", "/template-configs", { documentKind: "TRANSCRIPT", pack: "SECONDARY", templateKey: "secondary-bulletin" })).status).toBe(400); // nature incompatible
      expect((await call(director, "PUT", "/template-configs", { documentKind: "REPORT_CARD", pack: "SECONDARY", templateKey: "n-existe-pas" })).status).toBe(404);
      expect((await call(director, "PUT", "/template-configs", { documentKind: "REPORT_CARD", pack: "SECONDARY", templateKey: "secondary-bulletin", signatureAssignments: [{ slot: "inconnu", signatoryId: sig }] })).status).toBe(400);
      expect(ok(await call(director, "GET", "/template-configs?history=true&documentKind=REPORT_CARD")).items.length).toBeGreaterThanOrEqual(2);

      const preview = ok(await call(director, "POST", "/template-configs/preview", { documentKind: "REPORT_CARD", pack: "SECONDARY", pdf: true }));
      expect(preview.html).toContain("Élève".toUpperCase().slice(0, 1));
      expect(preview.html).toContain("EXEMPLE Élève");
      expect(preview.html).toContain("PROVISOIRE");
      expect(preview.html).not.toContain("ELEVE1"); // jamais d'élève réel
      expect(preview.html).not.toContain("<svg xmlns"); // jamais de QR : l'aperçu n'est pas vérifiable
      expect(Buffer.from(preview.pdfBase64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
      expect((await call(teacher, "POST", "/template-configs/preview", { documentKind: "REPORT_CARD", pack: "SECONDARY" })).status).toBe(403);
    });

    it("réglages : lecture ; blocage si impayé soumis à la feature ; politique de vérification", async () => {
      const s = ok(await call(director, "GET", "/settings"));
      expect(reportcardsSettingsDtoSchema.safeParse(s).success).toBe(true);
      features.delete("reportcard.block-unpaid");
      const refused = await call(director, "PUT", "/settings", { blockIfUnpaid: true });
      expect(refused.status).toBe(400);
      expect(refused.json.code).toBe("entitlements.feature_not_available");
      features.add("reportcard.block-unpaid");
      expect(ok(await call(director, "PUT", "/settings", { blockIfUnpaid: true, verificationShowsMention: true })).blockIfUnpaid).toBe(true);
      ok(await call(director, "PUT", "/settings", { blockIfUnpaid: false, verificationShowsMention: false }));
      expect((await call(director, "PUT", "/settings", { autre: 1 })).status).toBe(400);
      expect((await call(teacher, "PUT", "/settings", { requireDeliberation: true })).status).toBe(403);
    });
  });

  describe("console plateforme (JWT super-admin séparé du JWT tenant)", () => {
    const op = { authorization: "Bearer super-admin-token" };
    it("sans jeton opérateur : 401, même avec toutes les permissions d'un tenant", async () => {
      expect((await call(director, "GET", "/platform/keys")).status).toBe(401);
      expect((await call(null, "POST", "/platform/templates", {}, { authorization: "Bearer autre" })).status).toBe(401);
    });
    it("publication d'un gabarit : validé (liste noire) ; hostile refusé avec la liste des problèmes ; valide -> 201 immuable", async () => {
      const hostile = await call(null, "POST", "/platform/templates", { key: "pirate", documentKind: "REPORT_CARD", pack: "CORE", title: "Piège", body: '<div>{{ x }}<script>alert(1)</script><img src="http://169.254.169.254/"></div>', css: "@import url(http://evil.example/x.css);" }, op);
      expect(hostile.status).toBe(400);
      expect(hostile.json.code).toBe("reportcards.invalid_template");
      expect(hostile.json.details.problems.join(" ")).toMatch(/script|img|import/);
      const good = await call(null, "POST", "/platform/templates", { key: "tpl-test", documentKind: "REPORT_CARD", pack: "CORE", title: "Gabarit de test", body: "<div class=\"a\">{{ student.fullName }}</div>", css: ".a { color: #123456 }" }, op);
      expect(good.status, JSON.stringify(good.json)).toBe(201);
      expect(good.json).toMatchObject({ key: "tpl-test", version: 1, status: "PUBLISHED" });
      expect(good.json.contentHash).toMatch(/^[0-9a-f]{64}$/);
      const v2 = await call(null, "POST", "/platform/templates", { key: "tpl-test", documentKind: "REPORT_CARD", pack: "CORE", title: "Gabarit de test", body: "<p>v2</p>" }, op);
      expect(v2.json.version).toBe(2);
      const all = ok(await call(null, "GET", "/platform/templates", undefined, op));
      expect(all.items.some((t: any) => t.key === "tpl-test" && t.version === 2)).toBe(true);
      expect(ok(await call(null, "POST", "/platform/templates/seed", {}, op)).published).toEqual([]);
    });
    it("clés : liste publique côté console, retrait", async () => {
      unwrap(await ensureSigningKeyRegistered(world.deps));
      const keys = ok(await call(null, "GET", "/platform/keys", undefined, op));
      expect(keys.items.map((k: any) => k.keyId)).toContain("test-key-2026");
      expect((await call(null, "POST", "/platform/keys/BAD/retire", {}, op)).status).toBe(400);
    });
  });

  describe("vérification publique (sans authentification)", () => {
    let code: string;
    beforeAll(async () => {
      code = (await adminRows<any>(db, "SELECT verification_code FROM reportcards.report_cards WHERE tenant_id = $1 AND status = 'PUBLISHED' LIMIT 1", [school.tenantId]))[0].verification_code;
    });

    it("GET /public/verify/:code : 200 authentique sous les DEUX chemins (module et /api/v1/public), en-têtes no-store, sans cookie", async () => {
      for (const [prefix, who] of [["/api/v1/public", null], ["/api/v1/reportcards/public", null]] as const) {
        const r = await call(who, "GET", `/verify/${code}`, undefined, {}, prefix);
        expect(r.status, prefix).toBe(200);
        expect(reportcardsPublicVerificationDtoSchema.safeParse(r.json).success).toBe(true);
        expect(r.json.status).toBe("AUTHENTIC");
        expect(r.headers["cache-control"]).toBe("no-store");
        expect(r.headers["x-robots-tag"]).toBe("noindex");
        expect(r.headers["set-cookie"]).toBeUndefined();
      }
    });

    it("code inexistant ou mal formé : 404 avec EXACTEMENT le même corps", async () => {
      const bodies = await Promise.all(["A".repeat(26), "abc", "%27%3B%20DROP", "a".repeat(200)].map((c) => call(null, "GET", `/verify/${c}`, undefined, {}, "/api/v1/public")));
      for (const b of bodies) {
        expect(b.status).toBe(404);
        expect(b.json).toEqual(bodies[0]!.json);
      }
      expect(bodies[0]!.json.status).toBe("UNKNOWN");
    });

    it("POST /public/verify/upload : PDF brut ; l'original est reconnu, un autre fichier non ; type non supporté = 400/415", async () => {
      const render = (await adminRows<any>(db, "SELECT object_key FROM reportcards.renders WHERE status = 'RENDERED' AND tenant_id = $1 LIMIT 1", [school.tenantId]))[0];
      const pdf = Buffer.from((await world.storage.get(render.object_key))!.bytes);
      const match = await app.inject({ method: "POST", url: "/api/v1/public/verify/upload", headers: { "content-type": "application/pdf" }, payload: pdf });
      expect(match.statusCode).toBe(200);
      expect(reportcardsFileVerificationDtoSchema.safeParse(match.json()).success).toBe(true);
      expect(match.json()).toMatchObject({ match: true });
      const other = await app.inject({ method: "POST", url: "/api/v1/public/verify/upload", headers: { "content-type": "application/pdf" }, payload: Buffer.from("%PDF-1.4 pas un original") });
      expect(other.json()).toMatchObject({ match: false });
      const json = await app.inject({ method: "POST", url: "/api/v1/public/verify/upload", headers: { "content-type": "application/json" }, payload: "{}" });
      expect([400, 415]).toContain(json.statusCode);
      const huge = await app.inject({ method: "POST", url: "/api/v1/public/verify/upload", headers: { "content-type": "application/pdf" }, payload: Buffer.alloc(10 * 1024 * 1024 + 10) });
      expect(huge.statusCode).toBe(413);
    });

    it("clés publiques : /.well-known/ecoledigitale-keys.json et /public/keys", async () => {
      const wk = await app.inject({ method: "GET", url: "/.well-known/ecoledigitale-keys.json" });
      expect(wk.statusCode).toBe(200);
      expect(reportcardsPublicKeysDtoSchema.safeParse(wk.json()).success).toBe(true);
      expect(wk.json().keys[0]).toMatchObject({ keyId: "test-key-2026", algorithm: "Ed25519", status: "ACTIVE" });
      expect(JSON.stringify(wk.json())).not.toMatch(/PRIVATE|BEGIN/);
      expect((await call(null, "GET", "/keys", undefined, {}, "/api/v1/public")).status).toBe(200);
    });

    it(`limitation de débit : ${VERIFY_RATE_RULE.limit} requêtes/min/IP, puis 429 avec Retry-After (AC4.5)`, async () => {
      const rl = Fastify({ logger: false });
      await registerPublicRoutes(rl, { deps: world.deps, rateLimiter: new InMemoryRateLimiter(), prefix: "/p" });
      await rl.ready();
      const statuses: number[] = [];
      for (let i = 0; i < VERIFY_RATE_RULE.limit + 5; i += 1) {
        const r = await rl.inject({ method: "GET", url: `/p/verify/${"A".repeat(26)}`, remoteAddress: "198.51.100.7" });
        statuses.push(r.statusCode);
        if (i === VERIFY_RATE_RULE.limit) expect(r.headers["retry-after"]).toBeDefined();
      }
      expect(statuses.slice(0, VERIFY_RATE_RULE.limit).every((s) => s === 404)).toBe(true);
      expect(statuses.slice(VERIFY_RATE_RULE.limit).every((s) => s === 429)).toBe(true);
      // Une autre IP n'est pas pénalisée.
      expect((await rl.inject({ method: "GET", url: `/p/verify/${"A".repeat(26)}`, remoteAddress: "198.51.100.8" })).statusCode).toBe(404);
      await rl.close();
    });
  });

  it("aucune route n'écrit sur GET (hors audit de lecture) : les GET ne modifient ni le snapshot ni les statuts", async () => {
    const before = await adminRows<any>(db, "SELECT id, status, snapshot_hash, render_status FROM reportcards.report_cards WHERE tenant_id = $1 ORDER BY id", [school.tenantId]);
    for (const url of ["/report-cards", "/preflight?classroomId=" + school.classroomId + "&academicPeriodId=" + school.periodId, "/templates", "/settings", "/branding", "/signatories"]) {
      expect((await call(director, "GET", url)).status).toBe(200);
    }
    const after = await adminRows<any>(db, "SELECT id, status, snapshot_hash, render_status FROM reportcards.report_cards WHERE tenant_id = $1 ORDER BY id", [school.tenantId]);
    expect(after).toEqual(before);
    void createBatch;
    void operator;
  });
});
