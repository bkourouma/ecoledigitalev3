/**
 * Intégration HTTP (Fastify `inject`, Postgres réel ; s'ignore sans TEST_DATABASE_URL) : matrice de permissions du personnel
 * (chaque route exige SA permission du manifeste, une transition cite la sienne), routes publiques sans authentification mais
 * NEUTRES (mêmes réponses, aucune fuite, `no-store`, `noindex`, limiteur), multipart réel.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, createRequestContext, type RequestContext } from "@ecoledigitale/kernel";
import { admissionsPlugin, registerPublicRoutes, type RateLimiterLike } from "../../http/plugin";
import manifest from "../../manifest";
import { describeIntegration } from "../support/db";
import { acceptApplication, applicationBody, createWorld, openCampaignWith, openPublicForm, submittedApplication, unwrap, type World } from "../support/world";
import { createApplication, getApplication } from "../../application/applications";
import { issueOffer } from "../../application/offers";
import { upsertRequirement } from "../../application/reference";

const ALL = manifest.permissions.map((p) => p.key);
const PDF = new TextEncoder().encode("%PDF-1.4 piece\n%%EOF");

interface Part {
  name: string;
  value?: string;
  file?: { name: string; bytes: Uint8Array };
}
function multipart(parts: Part[]): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----ed-admissions-boundary";
  const chunks: Buffer[] = [];
  for (const p of parts) {
    if (p.file) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"; filename="${p.file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
      chunks.push(Buffer.from(p.file.bytes));
      chunks.push(Buffer.from("\r\n"));
    } else chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value ?? ""}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describeIntegration("admissions : HTTP", () => {
  let w: World;
  let staff: FastifyInstance;
  let pub: FastifyInstance;
  let hits = 0;
  let throttleAfter = Number.POSITIVE_INFINITY;
  let ctxA: RequestContext;
  let campaignId: string;
  let appId: string;
  const guardLog: string[] = [];

  beforeAll(async () => {
    w = await createWorld();
    ctxA = w.A.ctx();
    staff = Fastify({ logger: false });
    const { setErrorHandler: _unused } = staff as never as { setErrorHandler: unknown };
    void _unused;
    staff.decorateRequest("ctx", null as never);
    staff.addHook("onRequest", async (req) => {
      (req as unknown as { ctx: RequestContext }).ctx = createRequestContext({ tenantId: w.A.id, userId: String(req.headers["x-user"] ?? ctxA.userId) });
    });
    await staff.register(admissionsPlugin, {
      deps: w.A.deps,
      requirePermission: (permission) =>
        async function guard(request) {
          guardLog.push(permission);
          const granted = new Set(String(request.headers["x-perms"] ?? "").split(",").filter(Boolean));
          if (!granted.has(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
        },
    });
    const limiter: RateLimiterLike = {
      async hit() {
        hits += 1;
        return hits > throttleAfter ? { allowed: false, count: hits, retryAfterMs: 30_000 } : { allowed: true, count: hits, retryAfterMs: 0 };
      },
    };
    pub = Fastify({ logger: false });
    await registerPublicRoutes(pub, { deps: w.A.deps, rateLimiter: limiter, prefix: "/api/v1/public/admissions" });
    const campaign = await openCampaignWith(w.A, { seats: { CP1: 5 } });
    campaignId = campaign.id;
    const app = await submittedApplication(w.A, campaign.id);
    appId = app.id;
  });
  afterAll(async () => {
    await staff?.close();
    await pub?.close();
    await w?.close();
  });

  const call = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, perms: string[], payload?: unknown) =>
    staff.inject({ method, url, headers: { "x-perms": perms.join(",") }, ...(payload !== undefined ? { payload: payload as never } : {}) });

  const UUID = "0192f0a4-7b1e-7c3a-8d2e-0000000000ff";
  /** [méthode, chemin, permission(s) dont UNE suffit]. */
  const ROUTES: Array<["GET" | "POST" | "PUT" | "PATCH" | "DELETE", string, string[]]> = [
    ["GET", "/settings", ["admission.settings.manage", "admission.read"]],
    ["PUT", "/settings", ["admission.settings.manage"]],
    ["POST", "/settings/public-link", ["admission.settings.manage"]],
    ["POST", "/settings/initialize", ["admission.settings.manage"]],
    ["GET", "/priority-classes", ["admission.settings.manage", "admission.read"]],
    ["PUT", "/priority-classes", ["admission.settings.manage"]],
    ["PUT", "/decision-reasons", ["admission.settings.manage"]],
    ["PUT", "/document-requirements", ["admission.settings.manage"]],
    ["POST", "/consent-texts", ["admission.settings.manage"]],
    ["GET", "/workflows", ["admission.workflow.manage", "admission.read", "admission.campaign.manage"]],
    ["POST", "/workflows", ["admission.workflow.manage"]],
    ["GET", `/workflows/${UUID}`, ["admission.workflow.manage", "admission.read", "admission.campaign.manage"]],
    ["PUT", `/workflows/${UUID}/stages`, ["admission.workflow.manage"]],
    ["PUT", `/workflows/${UUID}/transitions`, ["admission.workflow.manage"]],
    ["POST", `/workflows/${UUID}/publish`, ["admission.workflow.publish"]],
    ["POST", `/workflows/${UUID}/new-version`, ["admission.workflow.manage"]],
    ["DELETE", `/workflows/${UUID}`, ["admission.workflow.manage"]],
    ["GET", "/campaigns", ["admission.read", "admission.campaign.manage"]],
    ["POST", "/campaigns", ["admission.campaign.manage"]],
    ["POST", `/campaigns/${UUID}/open`, ["admission.campaign.manage"]],
    ["PUT", `/campaigns/${UUID}/capacities`, ["admission.campaign.manage"]],
    ["GET", "/prospects", ["admission.prospect.manage"]],
    ["POST", "/prospects", ["admission.prospect.manage"]],
    ["POST", `/prospects/${UUID}/convert`, ["admission.prospect.manage"]],
    ["GET", "/applications", ["admission.read"]],
    ["GET", "/applications/board", ["admission.read"]],
    ["POST", "/applications", ["admission.create"]],
    ["GET", `/applications/${UUID}`, ["admission.read"]],
    ["PATCH", `/applications/${UUID}`, ["admission.update"]],
    ["GET", `/applications/${UUID}/history`, ["admission.read"]],
    ["POST", `/applications/${UUID}/transition`, ["admission.read"]],
    ["POST", `/applications/${UUID}/decisions`, ["admission.decide"]],
    ["POST", `/applications/${UUID}/documents`, ["admission.document.upload"]],
    ["POST", `/applications/${UUID}/documents/${UUID}/review`, ["admission.document.review"]],
    ["GET", `/applications/${UUID}/documents/${UUID}/url`, ["admission.document.review"]],
    ["POST", `/applications/${UUID}/consents`, ["admission.update"]],
    ["POST", `/applications/${UUID}/interviews`, ["admission.interview.manage"]],
    ["PATCH", `/applications/${UUID}/interviews/${UUID}`, ["admission.interview.manage"]],
    ["POST", `/applications/${UUID}/offers`, ["admission.offer.manage"]],
    ["POST", `/offers/${UUID}/withdraw`, ["admission.offer.manage"]],
    ["POST", `/offers/${UUID}/accept-on-behalf`, ["admission.offer.manage"]],
    ["GET", `/applications/${UUID}/duplicates`, ["admission.read"]],
    ["POST", `/applications/${UUID}/duplicates/detect`, ["admission.duplicate.resolve"]],
    ["POST", `/applications/${UUID}/duplicates/${UUID}/resolve`, ["admission.duplicate.resolve"]],
    ["POST", `/applications/${UUID}/anonymize`, ["admission.anonymize"]],
    ["GET", `/applications/${UUID}/export`, ["admission.export"]],
    ["GET", "/waitlist", ["admission.waitlist.manage"]],
    ["POST", "/waitlist/promote", ["admission.waitlist.manage"]],
    ["GET", "/reports/funnel", ["admission.report.read"]],
    ["GET", "/reports/capacity", ["admission.report.read"]],
    ["GET", "/reports/sla", ["admission.report.read"]],
    ["GET", "/reports/sources", ["admission.report.read"]],
    ["GET", "/reports/rejections", ["admission.report.read"]],
  ];

  it("MATRICE : sans permission ou avec toutes SAUF celle(s) requise(s) -> 403 ; chaque permission citée appartient au manifeste", async () => {
    const offenders: string[] = [];
    for (const [method, url, required] of ROUTES) {
      for (const r of required) if (!ALL.includes(r)) offenders.push(`${method} ${url} : permission inconnue ${r}`);
      const none = await call(method, url, []);
      if (none.statusCode !== 403) offenders.push(`${method} ${url} sans permission : ${none.statusCode}`);
      const others = await call(method, url, ALL.filter((p) => !required.includes(p)));
      if (others.statusCode !== 403) offenders.push(`${method} ${url} sans ${required.join("|")} : ${others.statusCode}`);
      const withIt = await call(method, url, [required[0] as string]);
      if (withIt.statusCode === 403 || withIt.statusCode === 401) offenders.push(`${method} ${url} avec ${required[0]} : ${withIt.statusCode}`);
    }
    expect(offenders).toEqual([]);
  });

  it("une transition cite SA permission (portée par le workflow) : la permission d'étude ne suffit pas à décider", async () => {
    const detail = unwrap(await getApplication(w.A.deps, w.A.ctx(), appId));
    const review = detail.allowedTransitions.find((t) => t.toStageCode === "UNDER_REVIEW")!;
    expect(review.permissionKey).toBe("admission.update");
    const denied = await call("POST", `/applications/${appId}/transition`, ["admission.read"], { toStageId: review.toStageId });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().details?.permission ?? denied.json().code).toBeDefined();
    const moved = await call("POST", `/applications/${appId}/transition`, ["admission.read", "admission.update"], { toStageId: review.toStageId });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().stageCode).toBe("UNDER_REVIEW");
    // Décision : `admission.decide` (route) ; un dépassement de capacité exige en plus la permission SENSIBLE.
    const afterReview = unwrap(await getApplication(w.A.deps, w.A.ctx(), appId));
    const accept = afterReview.allowedTransitions.find((t) => t.toStageCode === "ACCEPTED")!;
    const noDecide = await call("POST", `/applications/${appId}/decisions`, ["admission.update"], { toStageId: accept.toStageId, kind: "ACCEPT" });
    expect(noDecide.statusCode).toBe(403);
    const overrideDenied = await call("POST", `/applications/${appId}/decisions`, ["admission.decide"], { toStageId: accept.toStageId, kind: "ACCEPT", overrideCapacity: true, reasonText: "Fratrie d'un élève du personnel" });
    expect(overrideDenied.statusCode).toBe(403);
    const bypass = await call("POST", `/applications/${appId}/transition`, ["admission.read", "admission.decide"], { toStageId: accept.toStageId });
    expect(bypass.statusCode).toBe(409);
    expect(bypass.json().code).toBe("admissions.decision_missing");
    const decided = await call("POST", `/applications/${appId}/decisions`, ["admission.decide"], { toStageId: accept.toStageId, kind: "ACCEPT" });
    expect(decided.statusCode).toBe(200);
    expect(decided.json().status).toBe("ACCEPTED");
  });

  it("validation Zod stricte (400 stable), 404 hors périmètre, 409 sur règle de passage", async () => {
    const bad = await call("POST", "/applications", ["admission.create"], { campaignId, inconnu: true });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ kind: "validation" });
    const missing = await call("GET", `/applications/${UUID}`, ["admission.read"]);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("admissions.application_not_found");
    const created = await call("POST", "/applications", ["admission.create"], applicationBody(campaignId));
    expect(created.statusCode).toBe(201);
    expect(created.json().applicationNumber).toMatch(/^\d{4}-\d{5}$/);
    const board = await call("GET", `/applications/board?campaignId=${campaignId}`, ["admission.read"]);
    expect(board.statusCode).toBe(200);
    expect(board.json().columns.length).toBeGreaterThan(8);
    expect(board.headers["cache-control"]).toBe("no-store");
  });

  it("dépôt d'une pièce en multipart réel par le personnel ; type falsifié refusé", async () => {
    const req = unwrap(await upsertRequirement(w.A.deps, w.A.ctx(), { institutionId: w.A.institutionId, code: "ACTE_HTTP", label: "Acte (HTTP)", required: true, acceptsMime: ["application/pdf"] }));
    const created = unwrap(await createApplication(w.A.deps, w.A.ctx(), applicationBody(campaignId)));
    const ok = multipart([{ name: "requirementId", value: req.id }, { name: "file", file: { name: "acte.pdf", bytes: PDF } }]);
    const up = await staff.inject({ method: "POST", url: `/applications/${created.id}/documents`, headers: { ...ok.headers, "x-perms": "admission.document.upload" }, payload: ok.payload });
    expect(up.statusCode).toBe(200);
    expect(up.json().items.find((d: { requirementCode: string }) => d.requirementCode === "ACTE_HTTP").status).toBe("SUBMITTED");
    const forged = multipart([{ name: "requirementId", value: req.id }, { name: "file", file: { name: "acte.pdf", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0]) } }]);
    const bad = await staff.inject({ method: "POST", url: `/applications/${created.id}/documents`, headers: { ...forged.headers, "x-perms": "admission.document.upload" }, payload: forged.payload });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("admissions.file_rejected");
  });

  describe("routes publiques", () => {
    let school: string;
    beforeAll(async () => {
      school = await openPublicForm(w.A);
    });

    const get = (url: string) => pub.inject({ method: "GET", url: `/api/v1/public/admissions${url}`, headers: { "user-agent": "vitest" } });
    const post = (url: string, payload: unknown) => pub.inject({ method: "POST", url: `/api/v1/public/admissions${url}`, payload: payload as never });

    it("aucune authentification, aucune session : `no-store`, `noindex`, aucun cookie ; le formulaire ne fuit rien", async () => {
      const res = await get(`/forms/${school}`);
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-robots-tag"]).toContain("noindex");
      expect(res.headers["set-cookie"]).toBeUndefined();
      const body = res.json();
      expect(Object.keys(body).sort()).toEqual(["antiSpam", "consent", "documents", "formToken", "grades", "institutionName", "relationships"]);
      expect(JSON.stringify(body)).not.toMatch(/seats|capacit|waitlist|institutionId|tenant/i);
    });

    it("lien inconnu, mal formé, désactivé : MÊME 404 neutre (aucune énumération des établissements)", async () => {
      const unknown = await get(`/forms/${"b".repeat(26)}`);
      const malformed = await get("/forms/pas-un-slug");
      const missingPath = await get("/n-importe-quoi");
      expect(unknown.statusCode).toBe(404);
      expect(malformed.statusCode).toBe(404);
      expect(missingPath.statusCode).toBe(404);
      expect(malformed.json()).toEqual(unknown.json());
      expect(missingPath.json()).toEqual(unknown.json());
      expect(JSON.stringify(unknown.json())).not.toMatch(/établissement|school|tenant/i);
    });

    it("un dépôt invalide répond un 400 générique (ni champ, ni règle, ni donnée) ; un dépôt valide 201 {trackingCode, message}", async () => {
      const form = (await get(`/forms/${school}`)).json();
      const invalid = await post(`/forms/${school}/applications`, { formToken: form.formToken, extra: "x" });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toEqual({ status: 400, code: "admissions.invalid_input", kind: "validation", message: "Requête invalide. Rechargez la page et réessayez." });
      const fresh = (await get(`/forms/${school}`)).json();
      const ok = await post(`/forms/${school}/applications`, {
        formToken: fresh.formToken,
        applicantFirstName: "Binta",
        applicantLastName: "Camara",
        applicantBirthDate: "2019-05-05",
        isRepeating: false,
        desiredGradeLevelCode: "CP1",
        fundingTypeRequested: "PRIVATE",
        guardians: [{ relationshipCode: "MOTHER", firstName: "Hawa", lastName: "Camara", phone: "+22507123456", isPrimary: true, isFinancialResponsible: true, canConsent: true }],
        consent: { accepted: true, textVersion: "v1", guardianIndex: 0 },
      });
      expect(ok.statusCode).toBe(201);
      expect(Object.keys(ok.json()).sort()).toEqual(["message", "trackingCode"]);
      // Suivi : le code est dans le CORPS ; un code inconnu répond 404 neutre.
      const track = await post("/track", { school, trackingCode: ok.json().trackingCode });
      expect(track.statusCode).toBe(200);
      expect(track.json().phase).toBe("RECEIVED");
      expect(JSON.stringify(track.json())).not.toMatch(/Camara|Binta|stage|campaign/i);
      const unknownTrack = await post("/track", { school, trackingCode: "ZZZZ-ZZZZ-ZZZZ-ZZZZ" });
      expect(unknownTrack.statusCode).toBe(404);
      const getTrack = await pub.inject({ method: "GET", url: `/api/v1/public/admissions/track/${ok.json().trackingCode}` });
      expect(getTrack.statusCode).toBe(404); // le code ne circule jamais dans l'URL
    });

    it("dépôt d'une pièce par la famille (multipart) : type réel contrôlé", async () => {
      const req = unwrap(await upsertRequirement(w.A.deps, w.A.ctx(), { institutionId: w.A.institutionId, code: "PIECE_PUBLIQUE", label: "Pièce publique", required: true, acceptsMime: ["application/pdf"] }));
      const form = (await get(`/forms/${school}`)).json();
      const res = await post(`/forms/${school}/applications`, {
        formToken: form.formToken,
        applicantFirstName: "Daouda",
        applicantLastName: "Fofana",
        applicantBirthDate: "2019-09-09",
        isRepeating: false,
        desiredGradeLevelCode: "CP1",
        fundingTypeRequested: "PRIVATE",
        guardians: [{ relationshipCode: "FATHER", firstName: "Sékou", lastName: "Fofana", phone: "+22507654321", isPrimary: true, isFinancialResponsible: true, canConsent: true }],
        consent: { accepted: true, textVersion: "v1", guardianIndex: 0 },
      });
      const code = res.json().trackingCode as string;
      const good = multipart([{ name: "school", value: school }, { name: "trackingCode", value: code }, { name: "requirementId", value: req.id }, { name: "file", file: { name: "piece.pdf", bytes: PDF } }]);
      const up = await pub.inject({ method: "POST", url: "/api/v1/public/admissions/track/documents", headers: good.headers, payload: good.payload });
      expect(up.statusCode).toBe(201);
      const forged = multipart([{ name: "school", value: school }, { name: "trackingCode", value: code }, { name: "requirementId", value: req.id }, { name: "file", file: { name: "piece.pdf", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0]) } }]);
      const bad = await pub.inject({ method: "POST", url: "/api/v1/public/admissions/track/documents", headers: forged.headers, payload: forged.payload });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().message).not.toMatch(/mz|exe|signature/i);
      const noFile = multipart([{ name: "school", value: school }, { name: "trackingCode", value: code }, { name: "requirementId", value: req.id }]);
      expect((await pub.inject({ method: "POST", url: "/api/v1/public/admissions/track/documents", headers: noFile.headers, payload: noFile.payload })).statusCode).toBe(400);
    });

    it("réponse à une offre : consultation puis acceptation par lien à usage unique ; jeton inconnu -> 404 neutre", async () => {
      const campaign = await openCampaignWith(w.A, { seats: { CP1: 9 } });
      const app = await submittedApplication(w.A, campaign.id);
      await acceptApplication(w.A, app.id);
      const issued = unwrap(await issueOffer(w.A.deps, w.A.ctx(), app.id, { classroomId: w.A.rooms.cp1 }));
      const view = await post("/offers/view", { school, token: issued.responseToken });
      expect(view.statusCode).toBe(200);
      expect(view.json().status).toBe("PENDING");
      const accepted = await post("/offers/respond", { school, token: issued.responseToken, accept: true });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().status).toBe("ACCEPTED");
      expect(accepted.json().message).toContain("frais d'inscription");
      const unknown = await post("/offers/respond", { school, token: "x".repeat(43), accept: true });
      expect(unknown.statusCode).toBe(404);
      expect((await post("/offers/view", { school, token: "court" })).statusCode).toBe(404);
    });

    it("limiteur par IP : au-delà du plafond, 429 + Retry-After (avant tout traitement)", async () => {
      throttleAfter = hits + 1;
      expect((await get(`/forms/${school}`)).statusCode).toBe(200);
      const limited = await get(`/forms/${school}`);
      expect(limited.statusCode).toBe(429);
      expect(limited.headers["retry-after"]).toBeDefined();
      expect(limited.json().code).toBe("admissions.rate_limited");
      throttleAfter = Number.POSITIVE_INFINITY;
    });
  });
});
