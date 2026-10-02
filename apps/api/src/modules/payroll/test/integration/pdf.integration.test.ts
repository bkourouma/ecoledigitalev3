/**
 * PDF du bulletin de paie : `GET /payslips/:id/pdf` (gestion ou titulaire) et `GET /my/payslips/:id/pdf` (titulaire seulement).
 * Le rendu lui-même est celui de `reportcards` (port `documents`, doublure ici) ; ce test fixe CE QUE payroll décide :
 * qui peut demander le PDF, dans quel état du bulletin, avec quel contenu scellé, et comment la réponse est formée.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId, ok, noopLogger, type RequestContext } from "@ecoledigitale/kernel";
import manifest from "../../manifest";
import { payrollPlugin } from "../../http/plugin";
import { calculatePeriod } from "../../application/calculate";
import { createPayrollDeps } from "../../application/deps";
import { approvePayslips, payPayslips } from "../../application/workflow";
import type { OfficialDocumentInput, OfficialDocumentState, PayslipDocumentPort } from "../../application/ports";
import { adminRows, createPayrollTestDb, describeIntegration, type PayrollTestDb } from "../support/db";
import { addConfig, addPeriod, addStaff, createWorld, payslipRows, releasePending, session, unwrap, type World } from "../support/world";

const ALL = manifest.permissions.map((p) => p.key);
const MANAGER = ALL.filter((p) => p !== "payroll.payslip.read_own" && p !== "payroll.payslip.approve_owner" && p !== "payroll.my.dispute");
const TEACHER = ["payroll.payslip.read_own"];
const PDF = Buffer.from("%PDF-1.7\n%fake\n", "latin1");

/** Doublure du port `documents` : enregistre les demandes, répond selon un état réglable. */
class FakeDocuments implements PayslipDocumentPort {
  readonly calls: Array<{ ctx: RequestContext; input: OfficialDocumentInput }> = [];
  status: OfficialDocumentState["status"] = "RENDERED";
  async fetchOrRequest(ctx: RequestContext, input: OfficialDocumentInput) {
    this.calls.push({ ctx, input });
    return ok<OfficialDocumentState>({
      status: this.status,
      fileName: `${input.title.replace(/[^\p{L}\p{N} -]+/gu, "").replace(/\s+/g, "-")}.pdf`,
      bytes: this.status === "RENDERED" ? PDF : null,
      verificationCode: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      pdfHash: this.status === "RENDERED" ? "a".repeat(64) : null,
      lastError: null,
    });
  }
}

describeIntegration("PDF du bulletin de paie : accès, état, contenu scellé (Postgres réel)", () => {
  let db: PayrollTestDb;
  let w: World;
  let other: World;
  let app: FastifyInstance;
  let unwiredApp: FastifyInstance;
  const docs = new FakeDocuments();
  const features = new Set(["payroll.core", "payroll.owner-validation", "payroll.session-source", "payroll.attendance-source"]);
  const manager = newId();
  const awaUser = newId();
  const bobUser = newId();
  let awa: string;
  let paidSlip: string;
  let approvedSlip: string;
  let calculatedSlip: string;
  let bobPaidSlip: string;
  let otherSlip: string;

  const build = async (deps: ReturnType<typeof createPayrollDeps>): Promise<FastifyInstance> => {
    const a = Fastify({ logger: false });
    a.addHook("onRequest", async (req) => {
      const tenant = req.headers["x-test-tenant"];
      const user = req.headers["x-test-user"];
      if (typeof tenant === "string") (req as unknown as { ctx: unknown }).ctx = createRequestContext({ tenantId: tenant, userId: typeof user === "string" ? user : newId(), roles: [] });
    });
    await a.register(payrollPlugin, {
      deps,
      prefix: "/api/v1/payroll",
      requirePermission: (permission) => async (req) => {
        if (!(req as unknown as { ctx?: unknown }).ctx) throw new UnauthorizedError();
        if (!String(req.headers["x-test-perms"] ?? "").split(",").includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      requireFeature: (feature) => async (_req, reply) => {
        if (!features.has(feature)) return reply.status(403).send({ status: 403, code: "entitlements.feature_not_available" });
        return undefined;
      },
      isFeatureEnabled: async (_ctx, feature) => features.has(feature),
    });
    await a.ready();
    return a;
  };

  beforeAll(async () => {
    db = await createPayrollTestDb(24);
    w = await createWorld({ db });
    other = await createWorld({ db });
    awa = addStaff(w, "Awa Titulaire", { userId: awaUser });
    const bob = addStaff(w, "Bob Autre", { userId: bobUser });
    await addConfig(w, { staffId: awa });
    await addConfig(w, { staffId: bob });
    const withDocs = createPayrollDeps({ db: db.tenantDb, clock: w.clock, audit: w.audit, ports: { ...w.mem.ports, documents: docs } as never, logger: noopLogger });
    app = await build(withDocs);
    unwiredApp = await build(w.deps);

    const dates = ["2026-01-06", "2026-02-03", "2026-03-03"];
    const slips: string[] = [];
    for (const d of dates) {
      await releasePending(w);
      const month = d.slice(0, 7);
      const p = await addPeriod(w, { name: `Période ${month}`, startDate: `${month}-01`, endDate: `${month}-28` });
      w.mem.sessions.add(session(awa, d, 120));
      if (d === dates[0]) w.mem.sessions.add(session(bob, d, 60));
      unwrap(await calculatePeriod(w.deps, w.ctxOf(), { periodId: p.id }));
      slips.push((await payslipRows(w, "period_id=$2 AND staff_id=$3", [p.id, awa]))[0]?.id as string);
      if (d === dates[0]) bobPaidSlip = (await payslipRows(w, "period_id=$2 AND staff_id=$3", [p.id, bob]))[0]?.id as string;
    }
    [paidSlip, approvedSlip, calculatedSlip] = slips as [string, string, string];
    const approve = (ids: string[]) => approvePayslips(w.deps, w.ctxOf(manager), { selection: { payslipIds: ids }, caps: { ownerApproval: true } });
    unwrap(await approve([paidSlip, approvedSlip, bobPaidSlip]));
    unwrap(await payPayslips(w.deps, w.ctxOf(manager), { selection: { payslipIds: [paidSlip, bobPaidSlip] }, method: "CASH", reference: "RECU-2026-01" }));

    const x = addStaff(other, "Xavier Ailleurs", { userId: newId() });
    await addConfig(other, { staffId: x });
    const op = await addPeriod(other);
    other.mem.sessions.add(session(x, "2026-01-06", 60));
    unwrap(await calculatePeriod(other.deps, other.ctxOf(), { periodId: op.id }));
    otherSlip = (await payslipRows(other))[0]?.id as string;
  });
  afterAll(async () => {
    await app.close();
    await unwiredApp.close();
    await db.drop();
  });

  async function get(url: string, o: { user?: string; perms?: string[]; tenant?: string; target?: FastifyInstance } = {}) {
    const res = await (o.target ?? app).inject({
      method: "GET",
      url: `/api/v1/payroll${url}`,
      headers: { "x-test-tenant": o.tenant ?? w.tenantId, "x-test-user": o.user ?? awaUser, "x-test-perms": (o.perms ?? TEACHER).join(",") },
    });
    let json: any;
    try {
      json = res.json();
    } catch {
      json = undefined;
    }
    return { status: res.statusCode, json, res };
  }

  it("le titulaire télécharge le PDF de son bulletin VERSÉ : 200, PDF, pièce jointe, jamais mis en cache, code de vérification", async () => {
    const r = await get(`/my/payslips/${paidSlip}/pdf`);
    expect(r.status).toBe(200);
    expect(r.res.headers["content-type"]).toBe("application/pdf");
    expect(String(r.res.headers["content-disposition"])).toMatch(/^attachment; filename="Bulletin-de-paie-Période-2026-01\.pdf"$/);
    expect(r.res.headers["cache-control"]).toBe("private, no-store");
    expect(r.res.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.res.headers["x-document-verification-code"]).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(Buffer.from(r.res.rawPayload).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("contenu SCELLÉ : snapshot immuable de la paie + versement, titre sans nom, contexte mis en forme, entiers seulement", async () => {
    const last = docs.calls[docs.calls.length - 1]!;
    expect(last.input.sourceId).toBe(paidSlip);
    expect(last.input.title).toBe("Bulletin de paie — Période 2026-01"); // période seulement : publié par la vérification publique
    expect(last.input.title).not.toContain("Awa");
    const content = last.input.content as any;
    expect(content).toMatchObject({ payslipId: paidSlip, staff: { displayName: "Awa Titulaire" }, currency: "XOF", payment: { method: "CASH", reference: "RECU-2026-01" } });
    expect(content.payrollSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    const rows = await adminRows<{ snapshot_hash: string; total_amount: string }>(db, "SELECT s.snapshot_hash, p.total_amount::text FROM payroll.payslip_snapshots s JOIN payroll.payslips p ON p.id = s.payslip_id WHERE s.payslip_id = $1", [paidSlip]).catch(() => []);
    if (rows[0]) expect(rows[0].snapshot_hash).toBe(content.payrollSnapshotHash);
    expect(content.amounts.total).toBe(Number((await adminRows<{ t: string }>(db, "SELECT total_amount::text AS t FROM payroll.payslips WHERE id=$1", [paidSlip]))[0]!.t));
    // JSON canonique de reportcards : aucun flottant, aucun undefined
    const walk = (v: unknown): void => {
      if (typeof v === "number") expect(Number.isInteger(v)).toBe(true);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
      else expect(v).not.toBeUndefined();
    };
    walk(content);
    const ctxDoc = (last.input.context as any).payslip;
    expect(ctxDoc).toMatchObject({ staffName: "Awa Titulaire", periodName: "Période 2026-01" });
    expect(ctxDoc.totalText).toMatch(/F\s?CFA|XOF/);
    expect(ctxDoc.lines.length).toBeGreaterThan(0);
    expect(ctxDoc.lines[0].durationText).toBe("2 h");
  });

  it("la gestion télécharge le PDF de n'importe quel bulletin versé (route de gestion) ; le titulaire par la route de gestion avec read_own aussi", async () => {
    expect((await get(`/payslips/${paidSlip}/pdf`, { user: manager, perms: MANAGER })).status).toBe(200);
    expect((await get(`/payslips/${bobPaidSlip}/pdf`, { user: manager, perms: MANAGER })).status).toBe(200);
    expect((await get(`/payslips/${paidSlip}/pdf`, { perms: TEACHER })).status).toBe(200);
  });

  it("autre enseignant : 404 UNIFORME (même réponse qu'un bulletin inexistant), sur les deux routes ; aucun scellement déclenché", async () => {
    const before = docs.calls.length;
    const notMine = await get(`/my/payslips/${paidSlip}/pdf`, { user: bobUser });
    const missing = await get(`/my/payslips/${newId()}/pdf`, { user: bobUser });
    const viaManagerRoute = await get(`/payslips/${paidSlip}/pdf`, { user: bobUser });
    for (const r of [notMine, missing, viaManagerRoute]) expect(r.status).toBe(404);
    expect(notMine.json.message).toBe(viaManagerRoute.json.message);
    expect(docs.calls.length).toBe(before);
  });

  it("bulletin non versé : 409 `payroll.payslip_not_paid` (arrêté) ; brouillon calculé : 404 pour le titulaire ; aucun scellement", async () => {
    const before = docs.calls.length;
    const approved = await get(`/my/payslips/${approvedSlip}/pdf`);
    expect(approved.status).toBe(409);
    expect(approved.json.code).toBe("payroll.payslip_not_paid");
    expect((await get(`/my/payslips/${calculatedSlip}/pdf`)).status).toBe(404);
    const byManager = await get(`/payslips/${calculatedSlip}/pdf`, { user: manager, perms: MANAGER });
    expect(byManager.status).toBe(409);
    expect(docs.calls.length).toBe(before);
  });

  it("permissions : sans `read_own` 403 (route titulaire) ; la gestion n'a pas accès à la route titulaire ; sans contexte 401 ; autre tenant 404", async () => {
    expect((await get(`/my/payslips/${paidSlip}/pdf`, { perms: [] })).status).toBe(403);
    expect((await get(`/my/payslips/${paidSlip}/pdf`, { user: manager, perms: MANAGER })).status).toBe(403);
    expect((await app.inject({ method: "GET", url: `/api/v1/payroll/my/payslips/${paidSlip}/pdf` })).statusCode).toBe(401);
    expect((await get(`/my/payslips/${paidSlip}/pdf`, { tenant: other.tenantId })).status).toBe(404);
    expect((await get(`/payslips/${otherSlip}/pdf`, { user: manager, perms: MANAGER })).status).toBe(404); // bulletin d'un autre tenant, vu depuis w
  });

  it("rendu en cours : 202 + Retry-After ; rendu définitivement échoué : 409 ; reprise : de nouveau le PDF", async () => {
    docs.status = "PENDING";
    const pending = await get(`/my/payslips/${paidSlip}/pdf`);
    expect(pending.status).toBe(202);
    expect(pending.res.headers["retry-after"]).toBe("3");
    expect(pending.json).toEqual({ status: "PENDING", retryAfterSeconds: 3 });
    docs.status = "RENDERING";
    expect((await get(`/my/payslips/${paidSlip}/pdf`)).json.status).toBe("RENDERING");
    docs.status = "FAILED";
    const failed = await get(`/my/payslips/${paidSlip}/pdf`);
    expect(failed.status).toBe(409);
    expect(failed.json.code).toBe("payroll.document_render_failed");
    docs.status = "RENDERED";
    expect((await get(`/my/payslips/${paidSlip}/pdf`)).status).toBe(200);
  });

  it("service de documents non branché : échec FERMÉ (409 `payroll.port_unavailable`), jamais de PDF improvisé", async () => {
    const r = await get(`/my/payslips/${paidSlip}/pdf`, { target: unwiredApp });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("payroll.port_unavailable");
  });

  it("chaque téléchargement abouti est audité (identifiants et code de vérification seulement, jamais de montant)", async () => {
    const before = w.audit.entries.length;
    await get(`/my/payslips/${paidSlip}/pdf`);
    const entry = w.audit.entries.slice(before).find((e) => e.entry.action === "payroll.payslip.pdf_downloaded");
    expect(entry?.entry).toMatchObject({ resourceType: "payslip", resourceId: paidSlip, metadata: { verificationCode: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", holderAccess: true } });
    expect(JSON.stringify(entry?.entry)).not.toMatch(/amount|total/i);
  });
});
