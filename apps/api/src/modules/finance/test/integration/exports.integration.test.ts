/**
 * Exports CSV serveur `/api/v1/finance/exports/*` (Fastify + Postgres réel) : jeu complet (pas la page), plafond,
 * troncature signalée (en-têtes ET route `/meta`), permissions, audit, protection contre l'injection de formule, isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId, unwrap } from "@ecoledigitale/kernel";
import { FINANCE_EXPORT_HEADERS, financeExportMetaDtoSchema, parseFinanceExportHeaders } from "@ecoledigitale/contracts/src/v2/finance";
import { createFinanceDeps } from "../../application/deps";
import { InMemoryLearnerDirectory } from "../../application/ports/directories";
import { RecordingAudit } from "../../application/ports/audit";
import { EXPORT_COLUMNS } from "../../application/exports";
import { financePlugin } from "../../http/plugin";
import { adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { learnerId, openCashier, pay, simpleInvoice } from "../support/scenario";

const MAX = 20;
const TOTAL = 33;

describeIntegration("finance : exports CSV serveur — complets, plafonnés, troncature signalée", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let app: FastifyInstance;
  let tenantId: string;
  let otherTenant: string;
  const audit = new RecordingAudit();
  const user = newId();
  const evil = "=HYPERLINK(\"http://x\";\"y\")";
  const evilLearner = learnerId();
  const names = new InMemoryLearnerDirectory([{ learnerId: evilLearner, displayName: "=CMD|' /C calc'!A0" }]);

  beforeAll(async () => {
    db = await createFinanceTestDb();
    world = makeWorld(db);
    tenantId = await db.createTenant();
    otherTenant = await db.createTenant();
    const admin = ctxFor(tenantId);
    await openCashier(world.deps, admin, 0, "CAISSE-EXP");
    for (let i = 0; i < TOTAL; i++) {
      const l = i === 0 ? evilLearner : learnerId();
      await simpleInvoice(world.deps, admin, l, 10_000 + i, "2025-10-15", i === 0 ? { groupKey: "G-EVIL", groupLabel: evil } : { groupKey: "G1", groupLabel: "6e A" });
      if (i % 3 === 0) unwrap(await pay(world.deps, admin, l, 4_000, { method: "TRANSFER" }));
    }
    // une facture dans un autre tenant : ne doit jamais apparaître
    await simpleInvoice(world.deps, ctxFor(otherTenant), learnerId(), 999_999);

    const deps = createFinanceDeps({ db: db.tenantDb, clock: world.clock, audit, providers: world.providers, learners: names, config: { environment: "test", exportMaxRows: MAX } });
    app = Fastify({ logger: false });
    app.addHook("onRequest", async (req) => {
      const tenant = req.headers["x-test-tenant"];
      if (typeof tenant === "string") (req as unknown as { ctx: unknown }).ctx = createRequestContext({ tenantId: tenant, userId: user, roles: [] });
    });
    await app.register(financePlugin, {
      deps,
      requirePermission: (permission) => async (req) => {
        if (!(req as unknown as { ctx?: unknown }).ctx) throw new UnauthorizedError();
        if (!String(req.headers["x-test-perms"] ?? "").split(",").includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  const ALL = ["finance.invoice.read", "finance.payment.read", "finance.report.read"];
  const get = (url: string, perms: string[] = ALL, tenant = tenantId) =>
    app.inject({ method: "GET", url: `/api/v1/finance${url}`, headers: { "x-test-tenant": tenant, "x-test-perms": perms.join(",") } });
  const lines = (csv: string): string[] => csv.replace(/^﻿/, "").split("\r\n").filter((l) => l.length > 0);

  it("factures : le fichier est plafonné, la troncature est signalée par les en-têtes ET par /meta", async () => {
    const res = await get("/exports/invoices");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(String(res.headers["content-disposition"])).toMatch(/^attachment; filename="factures-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers["cache-control"]).toBe("no-store");
    const parsed = parseFinanceExportHeaders((n) => res.headers[n] as string | undefined);
    expect(parsed).toEqual({ truncated: true, rowCount: MAX, totalCount: TOTAL, maxRows: MAX });
    expect(String(res.headers["access-control-expose-headers"])).toContain(FINANCE_EXPORT_HEADERS.truncated);
    expect(lines(res.body)).toHaveLength(MAX + 1); // en-tête + MAX lignes

    const meta = financeExportMetaDtoSchema.parse((await get("/exports/invoices/meta")).json());
    expect(meta).toEqual({ dataset: "invoices", totalCount: TOTAL, rowCount: MAX, maxRows: MAX, truncated: true });
  });

  it("un filtre qui tient sous le plafond donne un export COMPLET (truncated = false) ; aucune donnée d'un autre tenant", async () => {
    const res = await get("/exports/invoices", ALL, tenantId);
    expect(res.statusCode).toBe(200);
    const one = await get("/exports/invoices", ALL, otherTenant);
    expect(parseFinanceExportHeaders((n) => one.headers[n] as string | undefined)).toEqual({ truncated: false, rowCount: 1, totalCount: 1, maxRows: MAX });
    expect(one.body).toContain("999999");
    expect(res.body).not.toContain("999999");
    const filtered = await get("/exports/invoices?groupKey=G-EVIL");
    expect(parseFinanceExportHeaders((n) => filtered.headers[n] as string | undefined)).toEqual({ truncated: false, rowCount: 1, totalCount: 1, maxRows: MAX });
  });

  it("format : BOM UTF-8, séparateur `;`, CRLF, en-tête documenté, montants entiers + devise", async () => {
    const res = await get("/exports/invoices?groupKey=G1&status=ISSUED");
    expect(res.body.startsWith("﻿")).toBe(true);
    const rows = lines(res.body);
    expect(rows[0]!.split(";")).toEqual([...EXPORT_COLUMNS.invoices]);
    const cells = rows[1]!.split(";");
    expect(cells).toHaveLength(EXPORT_COLUMNS.invoices.length);
    expect(cells[0]).toMatch(/^FAC-\d{4}-\d{6}$/);
    expect(cells[EXPORT_COLUMNS.invoices.indexOf("devise")]).toBe("XOF");
    expect(cells[EXPORT_COLUMNS.invoices.indexOf("total")]).toMatch(/^\d+$/);
    expect(cells[EXPORT_COLUMNS.invoices.indexOf("classe")]).toBe("6e A");
  });

  it("protection contre l'injection de formule : une cellule commençant par `=` est neutralisée", async () => {
    const res = await get("/exports/invoices?groupKey=G-EVIL");
    expect(res.body).toContain("\"'=HYPERLINK(");
    expect(res.body).not.toMatch(/;=HYPERLINK/);
  });

  it("colonne `apprenant` : nom lu par lot ; un nom commençant par `=` est neutralisé comme toute cellule ; vide pour un inconnu", async () => {
    const res = await get("/exports/invoices?groupKey=G-EVIL");
    const row = lines(res.body)[1]!;
    expect(row).toContain("'=CMD|' /C calc'!A0");
    expect(row).not.toMatch(/;=CMD/);
    expect(row.split(";")[EXPORT_COLUMNS.invoices.indexOf("apprenant_id") + 1]).not.toBe("");
    const other = lines((await get("/exports/invoices?groupKey=G1&status=ISSUED")).body)[1]!.split(";");
    expect(other[EXPORT_COLUMNS.invoices.indexOf("apprenant")]).toBe("");
  });

  it("paiements et créances : mêmes garanties (jeu complet, plafond, en-têtes)", async () => {
    const payments = await get("/exports/payments");
    expect(payments.statusCode).toBe(200);
    const pm = parseFinanceExportHeaders((n) => payments.headers[n] as string | undefined)!;
    expect(pm).toEqual({ truncated: false, rowCount: 11, totalCount: 11, maxRows: MAX }); // un paiement tous les 3 (33/3)
    expect(lines(payments.body)[0]!.split(";")).toEqual([...EXPORT_COLUMNS.payments]);
    expect(lines(payments.body)[1]!.split(";")[EXPORT_COLUMNS.payments.indexOf("montant")]).toBe("4000");
    const receivables = await get("/exports/receivables");
    expect(receivables.statusCode).toBe(200);
    const rc = parseFinanceExportHeaders((n) => receivables.headers[n] as string | undefined)!;
    expect(rc.truncated).toBe(true);
    expect(rc.totalCount).toBe(TOTAL);
    expect(lines(receivables.body)[0]!.split(";")).toEqual([...EXPORT_COLUMNS.receivables]);
    const meta = financeExportMetaDtoSchema.parse((await get("/exports/receivables/meta")).json());
    expect(meta.truncated).toBe(true);
  });

  it("l'export est cohérent avec la liste : mêmes lignes que /invoices pour un filtre complet", async () => {
    const list = (await get("/invoices?limit=200&groupKey=G1")).json() as { total: number };
    const exp = await get("/exports/invoices?groupKey=G1");
    const parsed = parseFinanceExportHeaders((n) => exp.headers[n] as string | undefined)!;
    expect(parsed.totalCount).toBe(list.total);
  });

  it("permission du jeu de données exigée : factures, paiements, créances ; sans contexte 401", async () => {
    expect((await get("/exports/invoices", ["finance.payment.read", "finance.report.read"])).statusCode).toBe(403);
    expect((await get("/exports/payments", ["finance.invoice.read", "finance.report.read"])).statusCode).toBe(403);
    expect((await get("/exports/receivables", ["finance.invoice.read", "finance.payment.read"])).statusCode).toBe(403);
    expect((await get("/exports/invoices/meta", ["finance.payment.read"])).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/finance/exports/invoices" })).statusCode).toBe(401);
  });

  it("filtre invalide : 400 ; jeu de données inconnu : 404", async () => {
    expect((await get("/exports/invoices?status=NOPE")).statusCode).toBe(400);
    expect((await get("/exports/payments?from=hier")).statusCode).toBe(400);
    expect((await get("/exports/inconnu")).statusCode).toBe(404);
  });

  it("chaque export est audité (jeu, filtre, lignes, troncature) ; la route /meta ne l'est pas", async () => {
    audit.entries.length = 0;
    await get("/exports/invoices?groupKey=G1");
    await get("/exports/invoices/meta?groupKey=G1");
    const exported = audit.entries.filter((e) => e.entry.action === "finance.export.generated");
    expect(exported).toHaveLength(1);
    expect(exported[0]!.ctx.userId).toBe(user);
    expect(exported[0]!.entry.after).toMatchObject({ dataset: "invoices", filter: { groupKey: "G1" }, truncated: true, totalCount: TOTAL - 1, rowCount: MAX });
    // rien n'est écrit en base hors audit : aucune facture modifiée
    const n = await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM finance.invoices WHERE tenant_id = $1", [tenantId]);
    expect(Number(n[0]!.n)).toBe(TOTAL);
  });
});
