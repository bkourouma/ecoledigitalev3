/**
 * Routes de recherche dans le texte des PDF (Fastify `inject`, Postgres réel, extraction réelle) : permissions, validation,
 * isolation de tenant, contrats de réponse, limiteur de débit. Les gardes de permission sont simulées à partir des capacités.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, createRequestContext, createSystemContext, type RequestContext } from "@ecoledigitale/kernel";
import { documentDetailDtoSchema, documentTextIndexStatusDtoSchema, documentTextReindexResultDtoSchema, documentTextSearchPageDtoSchema } from "@ecoledigitale/contracts/src/v2/documents";
import { documentsPlugin } from "../../http/plugin";
import { PERMISSIONS } from "../../http/guards";
import { createDocumentsDeps } from "../../application/deps";
import { indexPendingTexts } from "../../application/text-search";
import type { ActorCaps } from "../../domain/types";
import { IsolatedPdfExtractor, resolvePdfParserPath } from "../../infrastructure/pdf-text-extractor";
import { describeIntegration } from "../support/db";
import { textPdf } from "../support/pdfs";
import { CAPS, PEOPLE, USERS, createWorld, type World } from "../support/world";

const CAPS_BY_USER: Record<string, ActorCaps> = {
  [USERS.manager]: CAPS.manager,
  [USERS.secretary]: CAPS.secretary,
  [USERS.teacher]: CAPS.teacher,
  [USERS.parent]: CAPS.parent,
  [USERS.parent2]: CAPS.parent,
  [USERS.stranger]: CAPS.none,
};
const permissionsOf = (userId: string): Set<string> =>
  new Set(Object.entries(CAPS_BY_USER[userId] ?? {}).filter(([, v]) => v === true).map(([k]) => PERMISSIONS[k as keyof typeof PERMISSIONS]));

const parserPath = resolvePdfParserPath();
const suite = parserPath ? describeIntegration : describe.skip;

suite("module documents : HTTP de la recherche dans le texte des PDF", () => {
  let w: World;
  let app: FastifyInstance;
  let throttleAfter = Number.POSITIVE_INFINITY;
  let hits = 0;
  const ids: Record<string, string> = {};

  const call = (method: "GET" | "POST", url: string, user: string | null, payload?: unknown, tenant = w.tenantA) =>
    app.inject({ method, url, headers: { ...(user ? { "x-user": user, "x-tenant": tenant } : {}) }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

  beforeAll(async () => {
    w = await createWorld();
    (w.ports as { textExtractor: unknown }).textExtractor = new IsolatedPdfExtractor({ parserPath: parserPath as string });
    const m = { userId: USERS.manager, caps: CAPS.manager };
    ids.child = await w.seedDocument({ ...m, bytes: await textPdf(["Attestation de scolarité httpmarqueur enfant"]), fileName: "enfant.pdf", fields: { title: "Attestation enfant", ownerId: PEOPLE.child } });
    ids.other = await w.seedDocument({ ...m, bytes: await textPdf(["Attestation de scolarité httpmarqueur autre"]), fileName: "autre.pdf", fields: { title: "Attestation autre", ownerId: PEOPLE.other } });
    ids.medical = await w.seedDocument({ ...m, code: "STUDENT_MEDICAL", bytes: await textPdf(["Certificat httpmarqueur medical"]), fileName: "medical.pdf", fields: { title: "Certificat", ownerId: PEOPLE.other } });
    ids.b = await w.seedDocument({ tenantId: w.tenantB, ...m, bytes: await textPdf(["Attestation httpmarqueur tenantb"]), fileName: "b.pdf", fields: { title: "Document B", ownerId: PEOPLE.child } });
    for (const t of [w.tenantA, w.tenantB]) await indexPendingTexts(w.deps, createSystemContext(t));

    const deps = createDocumentsDeps({ db: w.db.tenantDb, clock: w.clock, audit: w.audit, ports: w.ports });
    app = Fastify({ logger: false });
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      const user = request.headers["x-user"];
      const tenant = request.headers["x-tenant"];
      if (typeof user === "string" && typeof tenant === "string") (request as unknown as { ctx: RequestContext }).ctx = createRequestContext({ tenantId: tenant, userId: user });
    });
    await app.register(documentsPlugin, {
      deps,
      resolveContext: (request) => {
        const ctx = (request as unknown as { ctx?: RequestContext }).ctx;
        if (!ctx) throw new ForbiddenError("sans contexte");
        return ctx;
      },
      requirePermission: (permission) => async (request) => {
        const ctx = (request as unknown as { ctx?: RequestContext }).ctx;
        if (!ctx) throw new ForbiddenError("Authentification requise.", { code: "UNAUTHORIZED" });
        if (!permissionsOf(ctx.userId as string).has(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      rateLimiter: {
        hit: async () => {
          hits += 1;
          return hits > throttleAfter ? { allowed: false, count: hits, retryAfterMs: 4500 } : { allowed: true, count: hits, retryAfterMs: 0 };
        },
      },
      isFeatureEnabled: async () => false,
    });
    await app.ready();
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await w?.drop();
  });

  it("sans contexte ou sans permission de lecture : refus ; la réponse n'est jamais mise en cache", async () => {
    expect((await call("GET", "/search?q=httpmarqueur", null)).statusCode).toBeGreaterThanOrEqual(401);
    expect((await call("GET", "/search?q=httpmarqueur", USERS.stranger)).statusCode).toBe(403);
    const ok = await call("GET", "/search?q=httpmarqueur", USERS.manager);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
  });

  it("la réponse respecte le contrat ; un parent ne reçoit que les pièces de son enfant (extrait compris)", async () => {
    const res = await call("GET", "/search?q=httpmarqueur", USERS.parent);
    expect(res.statusCode).toBe(200);
    const page = documentTextSearchPageDtoSchema.parse(res.json());
    expect(page.items.map((i) => i.document.id)).toEqual([ids.child]);
    expect(page.items[0]!.snippet.some((s) => s.match && s.text.toLowerCase().includes("httpmarqueur"))).toBe(true);
    const body = res.body.toLowerCase();
    expect(body).not.toContain("autre");
    expect(body).not.toContain("medical");
    // le parent d'un autre enfant voit la pièce médicale de CET enfant (sa propre audience), pas celle du premier
    const other = documentTextSearchPageDtoSchema.parse((await call("GET", "/search?q=httpmarqueur", USERS.parent2)).json());
    expect(other.items.map((i) => i.document.id).sort()).toEqual([ids.other!, ids.medical!].sort());
  });

  it("validation : requête trop courte ou absente, limite hors bornes, curseur falsifié -> 400 documents.invalid_input", async () => {
    for (const url of ["/search", "/search?q=a", "/search?q=%20%20", "/search?q=ab&limit=0", "/search?q=ab&limit=51", "/search?q=ab&kind=INCONNU", "/search?q=ab&categoryId=pas-un-uuid", `/search?q=ab&cursor=${Buffer.from('{"r":"x","id":"y"}').toString("base64url")}`]) {
      const res = await call("GET", url, USERS.manager);
      expect(res.statusCode, url).toBe(400);
      expect(res.json().code ?? res.json().error?.code, url).toBe("documents.invalid_input");
    }
    expect((await call("GET", `/search?q=${"a".repeat(101)}`, USERS.manager)).statusCode).toBe(400);
  });

  it("une requête étrange (opérateurs, guillemets ouverts, injection) ne provoque jamais d'erreur serveur", async () => {
    for (const q of ["'; DROP TABLE documents.documents; --", '"ouvert', "a & | ! ( b", "-seul", "OR OR OR", "\\\\", "%_%", "<script>"]) {
      const res = await call("GET", `/search?q=${encodeURIComponent(q)}`, USERS.manager);
      expect(res.statusCode, q).toBe(200);
      documentTextSearchPageDtoSchema.parse(res.json());
    }
  });

  it("isolation de tenant : le même mot ne remonte que les documents du tenant de l'appelant", async () => {
    const a = documentTextSearchPageDtoSchema.parse((await call("GET", "/search?q=httpmarqueur", USERS.manager, undefined, w.tenantA)).json());
    expect(a.items.map((i) => i.document.id)).not.toContain(ids.b);
    const b = documentTextSearchPageDtoSchema.parse((await call("GET", "/search?q=httpmarqueur", USERS.manager, undefined, w.tenantB)).json());
    expect(b.items.map((i) => i.document.id)).toEqual([ids.b]);
  });

  it("état et réindexation : réservés à la gestion ; le détail d'un document porte l'état d'indexation", async () => {
    for (const user of [USERS.secretary, USERS.teacher, USERS.parent, USERS.stranger]) {
      expect((await call("GET", "/search/status", user)).statusCode, user).toBe(403);
      expect((await call("POST", "/search/reindex", user, { scope: "ALL" })).statusCode, user).toBe(403);
    }
    const status = documentTextIndexStatusDtoSchema.parse((await call("GET", "/search/status", USERS.manager)).json());
    expect(status.counts.INDEXED).toBe(3);
    expect((await call("POST", "/search/reindex", USERS.manager, { scope: "BIZARRE" })).statusCode).toBe(400);
    const queued = documentTextReindexResultDtoSchema.parse((await call("POST", "/search/reindex", USERS.manager, { scope: "ALL" })).json());
    expect(queued.queued).toBe(3);
    const detail = documentDetailDtoSchema.parse((await call("GET", `/documents/${ids.child}`, USERS.manager)).json());
    expect(detail.textIndex).toMatchObject({ status: "PENDING", versionNo: 1 });
    expect(JSON.stringify(detail)).not.toContain("httpmarqueur");
    await indexPendingTexts(w.deps, createSystemContext(w.tenantA));
    expect(documentDetailDtoSchema.parse((await call("GET", `/documents/${ids.child}`, USERS.manager)).json()).textIndex).toMatchObject({ status: "INDEXED", pageCount: 1, truncated: false });
    // un parent voit l'état de la pièce de son enfant, jamais le texte
    expect(documentDetailDtoSchema.parse((await call("GET", `/documents/${ids.child}`, USERS.parent)).json()).textIndex?.status).toBe("INDEXED");
  });

  it("limiteur de débit : trop de recherches -> 429 avec Retry-After", async () => {
    throttleAfter = hits;
    try {
      const res = await call("GET", "/search?q=httpmarqueur", USERS.manager);
      expect(res.statusCode).toBe(429);
      expect(res.headers["retry-after"]).toBe("5");
    } finally {
      throttleAfter = Number.POSITIVE_INFINITY;
    }
  });
});
