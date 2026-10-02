/**
 * Routes FAMILLE `/api/v1/finance/me/*` (Fastify + Postgres réel) : matrice d'autorisation (RBAC × propriété), isolation
 * entre familles et entre tenants, 404 UNIFORME, minimisation des DTO, paiement en ligne initié par le parent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ForbiddenError, Money, UnauthorizedError, createRequestContext, newId, unwrap } from "@ecoledigitale/kernel";
import {
  financeFamilyInstallmentDtoSchema,
  financeFamilyInvoiceDetailDtoSchema,
  financeFamilyInvoiceSummaryDtoSchema,
  financeFamilyLearnersDtoSchema,
  financeFamilyOnlinePaymentDtoSchema,
  financeFamilyPaymentViewDtoSchema,
  financeFamilyStatementDtoSchema,
  financeReceiptDtoSchema,
} from "@ecoledigitale/contracts/src/v2/finance";
import { createScholarship, setLearnerFunding } from "../../application/catalog";
import { createFinanceDeps } from "../../application/deps";
import { createInvoice, issueInvoiceFromSchedule } from "../../application/invoices";
import { familyIdempotencyKey } from "../../application/family";
import { InMemoryGuardianship } from "../../application/ports/guardianship";
import { RecordingAudit } from "../../application/ports/audit";
import { financePlugin } from "../../http/plugin";
import manifest from "../../manifest";
import { adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { learnerId, nextKey, openCashier, pay, seedCatalog, simpleInvoice, YEAR } from "../support/scenario";

const PARENT_PERMS = ["finance.child.read", "finance.child.pay"];
const STUDENT_PERMS = ["finance.self.read", "finance.self.pay"];

interface CallOptions {
  tenant?: string;
  user: string;
  perms: string[];
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

const UNIFORM = { status: 404, code: "finance.not_found", message: "Ressource introuvable." };

describeIntegration("finance : routes famille /me/* (parent, élève) — autorisation, isolation, paiement", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let app: FastifyInstance;
  let appUnwired: FastifyInstance;
  let tenantId: string;
  let otherTenant: string;
  let features: Set<string>;
  const audit = new RecordingAudit();
  const guardianship = new InMemoryGuardianship();
  const staff = ctxFor("00000000-0000-4000-8000-000000000000");

  // Utilisateurs
  const p1 = newId(); // parent de L1 et (second lien) L2
  const p2 = newId(); // parent de L2 uniquement
  const student = newId(); // élève : sa fiche = L4
  const stranger = newId(); // utilisateur sans lien
  const teacher = newId();
  // Apprenants
  const L1 = learnerId();
  const L2 = learnerId();
  const L3 = learnerId(); // sans tuteur
  const L4 = learnerId();
  // Factures
  let inv1: string; // L1, émise, famille
  let inv1b: string; // L1, émise, famille, avec 4 échéances
  let invDraft: string; // L1, brouillon
  let invFunder: string; // L1, financeur (État)
  let inv2: string; // L2
  let inv4: string; // L4
  let pay1: string; // paiement manuel de la famille L1
  let receipt1: string;
  let payFunder: string;
  let receiptFunder: string;
  let pay2: string;
  let receipt2: string;

  beforeAll(async () => {
    db = await createFinanceTestDb();
    world = makeWorld(db);
    tenantId = await db.createTenant();
    otherTenant = await db.createTenant();
    features = new Set(["finance.online-payment", "finance.installments"]);

    guardianship.link(p1, L1).link(p1, L2).link(p2, L2).setStudent(student, L4);

    const deps = createFinanceDeps({
      db: db.tenantDb,
      clock: world.clock,
      audit,
      providers: world.providers,
      enrollments: world.enrollments,
      guardianship,
      config: { environment: "test" },
    });
    const makeApp = async (d: typeof deps): Promise<FastifyInstance> => {
      const a = Fastify({ logger: false });
      a.addHook("onRequest", async (req) => {
        const tenant = req.headers["x-test-tenant"];
        const user = req.headers["x-test-user"];
        if (typeof tenant === "string") {
          (req as unknown as { ctx: unknown }).ctx = createRequestContext({ tenantId: tenant, userId: typeof user === "string" ? user : newId(), roles: [] });
        }
      });
      await a.register(financePlugin, {
        deps: d,
        requirePermission: (permission) => async (req) => {
          if (!(req as unknown as { ctx?: unknown }).ctx) throw new UnauthorizedError();
          const granted = String(req.headers["x-test-perms"] ?? "").split(",");
          if (!granted.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
        },
        requireFeature: (key) => async (req) => {
          if (!features.has(key)) throw new ForbiddenError("Fonctionnalité indisponible.", { code: "entitlements.feature_not_available", details: { feature: key } });
          void req;
        },
        isFeatureEnabled: async (_ctx, key) => features.has(key),
      });
      await a.ready();
      return a;
    };
    app = await makeApp(deps);
    // Même module SANS port de tutelle branché : échec fermé.
    appUnwired = await makeApp(createFinanceDeps({ db: db.tenantDb, clock: world.clock, providers: world.providers, enrollments: world.enrollments, config: { environment: "test" } }));

    // ----- Données (créées par la gestion, tenant A) -----
    const admin = ctxFor(tenantId, staff.userId ?? newId());
    await seedCatalog(world.deps, admin);
    const adminDeps = createFinanceDeps({ db: db.tenantDb, clock: world.clock, audit: world.audit, providers: world.providers, enrollments: world.enrollments, config: { environment: "test" } });
    inv1 = (await simpleInvoice(adminDeps, admin, L1, 100_000, "2025-10-15")).invoice.id;
    inv2 = (await simpleInvoice(adminDeps, admin, L2, 80_000, "2025-10-15")).invoice.id;
    inv4 = (await simpleInvoice(adminDeps, admin, L4, 60_000, "2025-10-15")).invoice.id;
    const draft = unwrap(
      await createInvoice(adminDeps, admin, { learnerId: L1, academicYear: YEAR, lines: [{ category: "CANTEEN", description: "Cantine (brouillon)", unitAmount: Money.of(30_000, "XOF") }], dueDate: "2025-11-30" }),
    );
    invDraft = draft.invoices[0]!.invoice.id;
    // L1 : facture de scolarité à 4 échéances + part État (financeur) sur une facture liée
    unwrap(await setLearnerFunding(adminDeps, admin, { learnerId: L1, fundingType: "STATE_ASSIGNED", assignmentRef: "AFF-2025-0001" }));
    unwrap(await createScholarship(adminDeps, admin, { learnerId: L1, academicYear: YEAR, funderKind: "STATE", funderName: "État", reference: "AFF-2025-0001", coverage: { kind: "PERCENT", bps: 6000 } }));
    const split = unwrap(await issueInvoiceFromSchedule(adminDeps, admin, { learnerId: L1, academicYear: YEAR, items: [{ feeCode: "SCOL" }], idempotencyKey: nextKey("split") }));
    inv1b = split.invoices.find((i) => i.invoice.payerKind === "LEARNER")!.invoice.id;
    invFunder = split.invoices.find((i) => i.invoice.payerKind === "FUNDER")!.invoice.id;

    // Encaissements à la caisse : famille L1, famille L2, financeur (sur la facture de l'État)
    await openCashier(adminDeps, admin, 0, "CAISSE-FAM");
    const cashier = { method: "CASH" as const, reference: undefined };
    const p = unwrap(await pay(adminDeps, admin, L1, 40_000, { ...cashier, allocation: { mode: "AUTO", invoiceIds: [inv1] } }));
    pay1 = p.payment.id;
    receipt1 = p.receipt!.id;
    const q = unwrap(await pay(adminDeps, admin, L2, 20_000, { ...cashier, allocation: { mode: "AUTO", invoiceIds: [inv2] } }));
    pay2 = q.payment.id;
    receipt2 = q.receipt!.id;
    const f = unwrap(await pay(adminDeps, admin, L1, 50_000, { method: "TRANSFER", reference: "VIR-ETAT", payerKind: "FUNDER", payerRef: (await adminRows<{ payer_ref: string }>(db, "SELECT payer_ref FROM finance.invoices WHERE id = $1", [invFunder]))[0]!.payer_ref, allocation: { mode: "AUTO", invoiceIds: [invFunder] } }));
    payFunder = f.payment.id;
    receiptFunder = f.receipt!.id;
  });
  afterAll(async () => {
    await app.close();
    await appUnwired.close();
    await db.drop();
  });

  async function call(method: "GET" | "POST", url: string, o: CallOptions, target: FastifyInstance = app) {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    headers["x-test-tenant"] = o.tenant ?? tenantId;
    headers["x-test-user"] = o.user;
    headers["x-test-perms"] = o.perms.join(",");
    let payload: string | undefined;
    if (o.body !== undefined) {
      payload = JSON.stringify(o.body);
      headers["content-type"] = "application/json";
    }
    const res = await target.inject({ method, url: `/api/v1/finance${url}`, headers, payload, query: o.query });
    let json: any;
    try {
      json = res.json();
    } catch {
      json = undefined;
    }
    return { status: res.statusCode as number, json };
  }
  const asParent = (user = p1) => ({ user, perms: PARENT_PERMS });
  const asStudent = (user = student) => ({ user, perms: STUDENT_PERMS });
  const expectUniform404 = (r: { status: number; json: any }) => {
    expect(r.status).toBe(UNIFORM.status);
    expect(r.json.code).toBe("finance.not_found");
    expect(r.json.message).toBe(UNIFORM.message);
    expect(r.json.details ?? {}).toEqual({});
  };

  describe("liste des apprenants visibles", () => {
    it("le parent voit SES enfants (relation GUARDIAN), pas les autres", async () => {
      const r = await call("GET", "/me/learners", asParent(p1));
      expect(r.status).toBe(200);
      const dto = financeFamilyLearnersDtoSchema.parse(r.json);
      expect(dto.items.map((i) => i.learnerId).sort()).toEqual([L1, L2].sort());
      expect(dto.items.every((i) => i.relation === "GUARDIAN")).toBe(true);
      const r2 = await call("GET", "/me/learners", asParent(p2));
      expect(r2.json.items.map((i: any) => i.learnerId)).toEqual([L2]);
    });
    it("l'élève voit lui-même (SELF) ; un inconnu ne voit personne", async () => {
      const r = await call("GET", "/me/learners", asStudent());
      expect(r.json.items).toEqual([{ learnerId: L4, relation: "SELF" }]);
      const none = await call("GET", "/me/learners", { user: stranger, perms: [...PARENT_PERMS, ...STUDENT_PERMS] });
      expect(none.status).toBe(200);
      expect(none.json.items).toEqual([]);
    });
    it("seules les permissions détenues comptent : un parent avec `finance.self.read` seul ne voit pas ses enfants", async () => {
      const r = await call("GET", "/me/learners", { user: p1, perms: ["finance.self.read"] });
      expect(r.json.items).toEqual([]);
    });
    it("sans aucune permission famille : 403 ; sans contexte : 401", async () => {
      expect((await call("GET", "/me/learners", { user: teacher, perms: ["finance.invoice.read", "finance.payment.read"] })).status).toBe(403);
      const noCtx = await app.inject({ method: "GET", url: "/api/v1/finance/me/learners" });
      expect(noCtx.statusCode).toBe(401);
    });
  });

  describe("matrice d'autorisation : propriété côté serveur, 404 uniforme", () => {
    const READS = [
      (l: string) => `/me/learners/${l}/statement`,
      (l: string) => `/me/learners/${l}/invoices`,
      (l: string) => `/me/learners/${l}/installments`,
      (l: string) => `/me/learners/${l}/payments`,
      (l: string) => `/me/learners/${l}/receipts`,
    ];

    it("le parent lit l'enfant lié sur toutes les routes de lecture", async () => {
      for (const path of READS) {
        const r = await call("GET", path(L1), asParent(p1));
        expect(r.status, path(L1)).toBe(200);
      }
    });

    it("enfant d'une autre famille, apprenant sans tuteur, identifiant inexistant : MÊME 404 (rien ne distingue les cas)", async () => {
      const unknown = newId();
      for (const path of READS) {
        const other = await call("GET", path(L3), asParent(p2)); // L3 : aucun tuteur
        const notMine = await call("GET", path(L1), asParent(p2)); // L1 appartient à p1 (p2 ne l'est pas)
        const missing = await call("GET", path(unknown), asParent(p2));
        for (const r of [other, notMine, missing]) expectUniform404(r);
        expect(other.json.message).toBe(notMine.json.message);
        expect(JSON.stringify({ ...other.json, requestId: 0 })).toBe(JSON.stringify({ ...missing.json, requestId: 0 }));
      }
    });

    it("l'utilisateur sans lien (ni élève ni tuteur) n'obtient rien, même muni de toutes les permissions famille", async () => {
      for (const path of READS) expectUniform404(await call("GET", path(L1), { user: stranger, perms: [...PARENT_PERMS, ...STUDENT_PERMS] }));
    });

    it("l'élève ne lit que SA fiche ; ses permissions `self` ne donnent pas accès à un autre élève ni à un enfant", async () => {
      expect((await call("GET", `/me/learners/${L4}/statement`, asStudent())).status).toBe(200);
      expectUniform404(await call("GET", `/me/learners/${L1}/statement`, asStudent()));
      // Un tuteur-élève : la relation SELF prime, mais la permission du bon type est exigée
      expectUniform404(await call("GET", `/me/learners/${L4}/statement`, { user: student, perms: ["finance.child.read"] }));
    });

    it("un parent avec la seule permission `self` ne lit pas son enfant (la permission doit correspondre à la relation)", async () => {
      expectUniform404(await call("GET", `/me/learners/${L1}/statement`, { user: p1, perms: ["finance.self.read"] }));
    });

    it("un lien de tutelle retiré ferme l'accès immédiatement (relu à chaque requête)", async () => {
      const temp = newId();
      guardianship.link(temp, L3);
      expect((await call("GET", `/me/learners/${L3}/statement`, asParent(temp))).status).toBe(200);
      guardianship.unlink(temp, L3);
      expectUniform404(await call("GET", `/me/learners/${L3}/statement`, asParent(temp)));
    });

    it("port de tutelle non branché : échec fermé, personne ne voit rien", async () => {
      const list = await call("GET", "/me/learners", asParent(p1), appUnwired);
      expect(list.json.items).toEqual([]);
      expectUniform404(await call("GET", `/me/learners/${L1}/statement`, asParent(p1), appUnwired));
    });

    it("identifiant d'apprenant invalide : 400 de validation (aucune information d'existence)", async () => {
      expect((await call("GET", "/me/learners/pas-un-uuid/statement", asParent(p1))).status).toBe(400);
    });

    it("isolation entre tenants : les données du tenant A restent invisibles depuis le tenant B", async () => {
      const st = await call("GET", `/me/learners/${L1}/statement`, { ...asParent(p1), tenant: otherTenant });
      expect(st.status).toBe(200); // la tutelle d'essai est la même ; RLS ne rend aucune ligne
      expect(st.json.invoices).toEqual([]);
      expect(st.json.totals.billed.amount).toBe(0);
      expectUniform404(await call("GET", `/me/learners/${L1}/invoices/${inv1}`, { ...asParent(p1), tenant: otherTenant }));
      expectUniform404(await call("GET", `/me/learners/${L1}/receipts/${receipt1}`, { ...asParent(p1), tenant: otherTenant }));
    });
  });

  describe("factures, échéances, paiements, reçus : contenu filtré", () => {
    it("situation financière : factures ÉMISES à la charge de la famille uniquement ; totaux cohérents", async () => {
      const r = await call("GET", `/me/learners/${L1}/statement`, asParent(p1));
      expect(r.status).toBe(200);
      const dto = financeFamilyStatementDtoSchema.parse(r.json);
      const ids = dto.invoices.map((i) => i.id);
      expect(ids).toContain(inv1);
      expect(ids).toContain(inv1b);
      expect(ids).not.toContain(invDraft); // brouillon : jamais
      expect(ids).not.toContain(invFunder); // part État : jamais
      expect(dto.invoices.every((i) => i.payerKind === "LEARNER" && i.number !== null)).toBe(true);
      expect(dto.payments.map((p) => p.id)).toEqual([pay1]); // pas le paiement du financeur
      // facturé = facture 1 (100 000) + part famille de la scolarité (40 % de 500 000 = 200 000)
      expect(dto.totals.billed.amount).toBe(300_000);
      expect(dto.totals.collected.amount).toBe(40_000);
      expect(dto.totals.outstanding.amount).toBe(260_000);
    });

    it("aucun champ interne dans les DTO famille", async () => {
      const st = await call("GET", `/me/learners/${L1}/statement`, asParent(p1));
      const inv = JSON.stringify(st.json.invoices);
      expect(inv).not.toContain("payerRef");
      expect(inv).not.toContain("cancelReason");
      for (const p of st.json.payments) {
        for (const k of ["providerRef", "simulated", "cashSessionId", "payerRef"]) expect(p, k).not.toHaveProperty(k);
      }
      const detail = await call("GET", `/me/learners/${L1}/invoices/${inv1}`, asParent(p1));
      expect(detail.json).not.toHaveProperty("payerRef");
      expect(detail.json).not.toHaveProperty("cancelReason");
    });

    it("liste et détail des factures (avec échéances) ; sous-ressource d'une autre famille / brouillon / financeur : 404 uniforme", async () => {
      const list = await call("GET", `/me/learners/${L1}/invoices`, asParent(p1));
      expect(list.status).toBe(200);
      expect(list.json.total).toBe(2);
      for (const i of list.json.items) financeFamilyInvoiceSummaryDtoSchema.parse(i);
      const detail = await call("GET", `/me/learners/${L1}/invoices/${inv1b}`, asParent(p1));
      expect(detail.status).toBe(200);
      const dto = financeFamilyInvoiceDetailDtoSchema.parse(detail.json);
      expect(dto.installments.length).toBeGreaterThan(1);
      // la facture de L2 via le chemin de L1 : 404 ; draft : 404 ; financeur : 404 ; hors chemin de propriété : 404
      expectUniform404(await call("GET", `/me/learners/${L1}/invoices/${inv2}`, asParent(p1)));
      expectUniform404(await call("GET", `/me/learners/${L1}/invoices/${invDraft}`, asParent(p1)));
      expectUniform404(await call("GET", `/me/learners/${L1}/invoices/${invFunder}`, asParent(p1)));
      expectUniform404(await call("GET", `/me/learners/${L1}/invoices/${newId()}`, asParent(p1)));
      expectUniform404(await call("GET", `/me/learners/${L2}/invoices/${inv1}`, asParent(p1))); // p1 est tuteur de L2, mais inv1 est à L1
      expectUniform404(await call("GET", `/me/learners/${L1}/invoices/${inv1}`, asParent(p2)));
    });

    it("échéances : ouvertes ou toutes, triées par date, avec le numéro de facture ; aucune échéance de brouillon ni de financeur", async () => {
      const all = await call("GET", `/me/learners/${L1}/installments`, asParent(p1));
      expect(all.status).toBe(200);
      const items = all.json.items.map((i: unknown) => financeFamilyInstallmentDtoSchema.parse(i));
      const invoiceIds = new Set(items.map((i: { invoiceId: string }) => i.invoiceId));
      expect(invoiceIds).toEqual(new Set([inv1, inv1b]));
      const dates = items.map((i: { dueDate: string }) => i.dueDate);
      expect([...dates].sort()).toEqual(dates);
      expect(items.every((i: { invoiceNumber: string }) => /^FAC-/.test(i.invoiceNumber))).toBe(true);
      const open = await call("GET", `/me/learners/${L1}/installments`, { ...asParent(p1), query: { open: "true" } });
      expect(open.json.items.every((i: { remaining: { amount: number } }) => i.remaining.amount > 0)).toBe(true);
    });

    it("paiements et reçus : ceux de la famille ; celui du financeur et ceux d'un autre apprenant sont introuvables", async () => {
      const payments = await call("GET", `/me/learners/${L1}/payments`, asParent(p1));
      expect(payments.json.items.map((p: any) => p.id)).toEqual([pay1]);
      const view = await call("GET", `/me/learners/${L1}/payments/${pay1}`, asParent(p1));
      expect(view.status).toBe(200);
      const dto = financeFamilyPaymentViewDtoSchema.parse(view.json);
      expect(dto.receipt?.id).toBe(receipt1);
      expectUniform404(await call("GET", `/me/learners/${L1}/payments/${payFunder}`, asParent(p1)));
      expectUniform404(await call("GET", `/me/learners/${L1}/payments/${pay2}`, asParent(p1)));
      expectUniform404(await call("GET", `/me/learners/${L1}/payments/${pay1}`, asParent(p2)));

      const receipts = await call("GET", `/me/learners/${L1}/receipts`, asParent(p1));
      expect(receipts.json.items.map((r: any) => r.id)).toEqual([receipt1]);
      const one = await call("GET", `/me/learners/${L1}/receipts/${receipt1}`, asParent(p1));
      financeReceiptDtoSchema.parse(one.json);
      expectUniform404(await call("GET", `/me/learners/${L1}/receipts/${receiptFunder}`, asParent(p1)));
      expectUniform404(await call("GET", `/me/learners/${L1}/receipts/${receipt2}`, asParent(p1)));
      expectUniform404(await call("GET", `/me/learners/${L2}/receipts/${receipt1}`, asParent(p1)));
    });

    it("l'élève lit sa propre situation (SELF)", async () => {
      const st = await call("GET", `/me/learners/${L4}/statement`, asStudent());
      expect(st.json.invoices.map((i: any) => i.id)).toEqual([inv4]);
      expect(st.json.totals.outstanding.amount).toBe(60_000);
    });

    it("les routes d'administration restent fermées au parent (pas de contournement par /invoices ou /learners/:id/statement)", async () => {
      for (const url of [`/invoices/${inv1}`, `/learners/${L1}/statement`, `/payments/${pay1}`, `/receipts/${receipt1}`, "/reports/summary"]) {
        expect((await call("GET", url, asParent(p1))).status, url).toBe(403);
      }
    });
  });

  describe("paiement en ligne initié par le parent", () => {
    const body = (invoiceId: string, amount: number, extra: Record<string, unknown> = {}) => ({ invoiceId, amount, provider: "sandbox", ...extra });

    it("201 : paiement confirmé (sandbox), imputé à la facture visée, initié PAR le parent (created_by) et audité", async () => {
      const key = nextKey("fam");
      const r = await call("POST", `/me/learners/${L1}/payments/online`, { ...asParent(p1), body: body(inv1, 25_000), headers: { "idempotency-key": key } });
      expect(r.status).toBe(201);
      const dto = financeFamilyOnlinePaymentDtoSchema.parse(r.json);
      expect(dto.payment.status).toBe("CONFIRMED");
      expect(dto.payment.learnerId).toBe(L1);
      expect(dto.allocations.map((a) => a.invoiceId)).toEqual([inv1]);
      expect(r.json.payment).not.toHaveProperty("providerRef");
      const row = (await adminRows<{ created_by: string; payer_kind: string; intended_invoice_id: string; idempotency_key: string }>(db, "SELECT created_by, payer_kind, intended_invoice_id, idempotency_key FROM finance.payments WHERE id = $1", [dto.payment.id]))[0]!;
      expect(row.created_by).toBe(p1);
      expect(row.payer_kind).toBe("LEARNER");
      expect(row.intended_invoice_id).toBe(inv1);
      expect(row.idempotency_key).toBe(familyIdempotencyKey(p1, key)); // espace de noms par utilisateur
      const entry = audit.entries.find((e) => e.entry.action === "finance.payment.family_initiated" && e.entry.resourceId === dto.payment.id);
      expect(entry?.ctx.userId).toBe(p1);
      expect(entry?.entry.after).toMatchObject({ learnerId: L1, relation: "GUARDIAN", invoiceId: inv1, amount: 25_000 });
      // la facture est bien réduite
      const st = await call("GET", `/me/learners/${L1}/invoices/${inv1}`, asParent(p1));
      expect(st.json.paid.amount).toBe(65_000);
    });

    it("rejeu avec la même clé : 200 et le MÊME paiement (aucun doublon)", async () => {
      const key = nextKey("fam");
      const first = await call("POST", `/me/learners/${L1}/payments/online`, { ...asParent(p1), body: body(inv1, 1_000), headers: { "idempotency-key": key } });
      const again = await call("POST", `/me/learners/${L1}/payments/online`, { ...asParent(p1), body: body(inv1, 1_000), headers: { "idempotency-key": key } });
      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.json.payment.id).toBe(first.json.payment.id);
      expect(again.json.replayed).toBe(true);
    });

    it("la clé d'un parent ne peut ni rejouer ni heurter le paiement d'un autre compte (espace de noms par utilisateur)", async () => {
      const key = nextKey("shared");
      const a = await call("POST", `/me/learners/${L2}/payments/online`, { ...asParent(p1), body: body(inv2, 2_000), headers: { "idempotency-key": key } });
      const b = await call("POST", `/me/learners/${L2}/payments/online`, { ...asParent(p2), body: body(inv2, 2_000), headers: { "idempotency-key": key } });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201); // pas 200 (rejeu du paiement d'autrui) ni 409
      expect(b.json.payment.id).not.toBe(a.json.payment.id);
      // même clé, demande DIFFÉRENTE, même compte : 409 (comportement d'idempotence conservé)
      const conflict = await call("POST", `/me/learners/${L2}/payments/online`, { ...asParent(p2), body: body(inv2, 3_000), headers: { "idempotency-key": key } });
      expect(conflict.status).toBe(409);
      expect(conflict.json.code).toBe("finance.idempotency_key_reused");
    });

    it("facture d'un autre enfant, brouillon, part du financeur, facture inconnue : 404 uniforme AVANT tout appel fournisseur", async () => {
      const before = (await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM finance.payments"))[0]!.n;
      for (const [learner, invoice] of [[L1, inv2], [L1, invDraft], [L1, invFunder], [L1, newId()], [L2, inv1]] as const) {
        const r = await call("POST", `/me/learners/${learner}/payments/online`, { ...asParent(p1), body: body(invoice, 1_000), headers: { "idempotency-key": nextKey("bad") } });
        expectUniform404(r);
      }
      // enfant non lié
      expectUniform404(await call("POST", `/me/learners/${L1}/payments/online`, { ...asParent(p2), body: body(inv1, 1_000), headers: { "idempotency-key": nextKey("bad") } }));
      expectUniform404(await call("POST", `/me/learners/${L3}/payments/online`, { ...asParent(p1), body: body(inv1, 1_000), headers: { "idempotency-key": nextKey("bad") } }));
      expect((await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM finance.payments"))[0]!.n).toBe(before);
    });

    it("montant supérieur au reste dû : 400 ; devise différente : 400 ; facture soldée : 409", async () => {
      const tooMuch = await call("POST", `/me/learners/${L4}/payments/online`, { ...asStudent(), body: body(inv4, 60_001), headers: { "idempotency-key": nextKey("big") } });
      expect(tooMuch.status).toBe(400);
      expect(tooMuch.json.code).toBe("finance.allocation_exceeds_remaining");
      const wrongCurrency = await call("POST", `/me/learners/${L4}/payments/online`, { ...asStudent(), body: body(inv4, 1_000, { currency: "EUR" }), headers: { "idempotency-key": nextKey("cur") } });
      expect(wrongCurrency.status).toBe(400);
      // solde complet de L4 puis nouvelle tentative
      const full = await call("POST", `/me/learners/${L4}/payments/online`, { ...asStudent(), body: body(inv4, 60_000), headers: { "idempotency-key": nextKey("full") } });
      expect(full.status).toBe(201);
      const again = await call("POST", `/me/learners/${L4}/payments/online`, { ...asStudent(), body: body(inv4, 1_000), headers: { "idempotency-key": nextKey("late") } });
      expect(again.status).toBe(409);
      expect(again.json.code).toBe("finance.invoice_not_payable");
    });

    it("la facture visée est OBLIGATOIRE ; champ inconnu refusé ; clé d'idempotence obligatoire", async () => {
      const noInvoice = await call("POST", `/me/learners/${L1}/payments/online`, { ...asParent(p1), body: { amount: 1_000, provider: "sandbox" }, headers: { "idempotency-key": nextKey("x") } });
      expect(noInvoice.status).toBe(400);
      const extra = await call("POST", `/me/learners/${L1}/payments/online`, { ...asParent(p1), body: { ...body(inv1, 1_000), payerKind: "FUNDER" }, headers: { "idempotency-key": nextKey("x") } });
      expect(extra.status).toBe(400);
      const noKey = await call("POST", `/me/learners/${L1}/payments/online`, { ...asParent(p1), body: body(inv1, 1_000) });
      expect(noKey.status).toBe(400);
    });

    it("permission `pay` requise (`read` seule : 403) ; feature de paiement en ligne requise (403 entitlements)", async () => {
      const readOnly = await call("POST", `/me/learners/${L1}/payments/online`, { user: p1, perms: ["finance.child.read"], body: body(inv1, 1_000), headers: { "idempotency-key": nextKey("ro") } });
      expect(readOnly.status).toBe(403);
      // un parent avec seulement `finance.self.pay` passe la garde de route mais échoue la propriété (relation GUARDIAN ⇒ `child.pay`)
      expectUniform404(await call("POST", `/me/learners/${L1}/payments/online`, { user: p1, perms: ["finance.self.pay"], body: body(inv1, 1_000), headers: { "idempotency-key": nextKey("mism") } }));
      features.delete("finance.online-payment");
      try {
        const noFeature = await call("POST", `/me/learners/${L1}/payments/online`, { ...asParent(p1), body: body(inv1, 1_000), headers: { "idempotency-key": nextKey("nf") } });
        expect(noFeature.status).toBe(403);
        expect(noFeature.json.code).toBe("entitlements.feature_not_available");
      } finally {
        features.add("finance.online-payment");
      }
    });

    it("paiement en attente : suivi et vérification par la famille propriétaire uniquement", async () => {
      // montant se terminant par 001 : le fournisseur sandbox répond « en attente »
      const started = await call("POST", `/me/learners/${L2}/payments/online`, { ...asParent(p2), body: body(inv2, 5_001), headers: { "idempotency-key": nextKey("pend") } });
      expect(started.status).toBe(201);
      expect(started.json.payment.status).toBe("PENDING");
      const id = started.json.payment.id as string;
      expect((await call("GET", `/me/learners/${L2}/payments/${id}`, asParent(p2))).json.payment.status).toBe("PENDING");
      // un parent d'une autre famille ne peut ni le voir ni le vérifier
      expectUniform404(await call("GET", `/me/learners/${L2}/payments/${id}`, { user: stranger, perms: PARENT_PERMS }));
      expectUniform404(await call("POST", `/me/learners/${L2}/payments/${id}/verify`, { user: stranger, perms: PARENT_PERMS }));
      expectUniform404(await call("POST", `/me/learners/${L1}/payments/${id}/verify`, asParent(p1))); // mauvais apprenant dans le chemin
      const verified = await call("POST", `/me/learners/${L2}/payments/${id}/verify`, asParent(p2));
      expect(verified.status).toBe(200);
      financeFamilyPaymentViewDtoSchema.parse(verified.json);
    });

    it("l'élève peut payer pour lui-même (`finance.self.pay`) ; la relation SELF est tracée dans l'audit", async () => {
      const r = await call("POST", `/me/learners/${L4}/payments/online`, { ...asStudent(), body: body(inv4, 0), headers: { "idempotency-key": nextKey("s0") } });
      expect(r.status).toBe(400); // montant nul refusé
      const row = audit.entries.filter((e) => e.entry.action === "finance.payment.family_initiated").map((e) => (e.entry.after as { relation: string }).relation);
      expect(row).toContain("GUARDIAN");
      expect(row).toContain("SELF"); // paiement intégral de L4 plus haut
    });
  });
});
