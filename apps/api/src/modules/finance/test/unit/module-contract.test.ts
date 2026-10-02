import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isValidEventType, resolveModuleOrder } from "@ecoledigitale/kernel";
import { loadMigrations } from "@ecoledigitale/database";
import {
  FINANCE_CURRENCIES,
  FINANCE_FEE_CATEGORIES,
  FINANCE_FUNDING_TYPES,
  FINANCE_INVOICE_STATUSES,
  FINANCE_PAYMENT_METHODS,
  FINANCE_PAYMENT_STATUSES,
  FINANCE_REFUND_STATUSES,
  financeAmountSchema,
  financeAllocationSpecSchema,
  financeCreateFeeScheduleBodySchema,
  financeIdempotencyKeySchema,
  financeInvoiceFromScheduleBodySchema,
  financeRecordPaymentBodySchema,
  financeWebhookParamsSchema,
} from "@ecoledigitale/contracts/src/v2/finance";
import * as contractsV2 from "@ecoledigitale/contracts/src/v2";
import manifest from "../../manifest";
import { rbacManifest } from "../../../rbac";
import financeAllowlist, { financeIsolationAllowlist, financeTenantTables } from "../../../isolation-allowlist.finance";
import { ALL_FINANCE_EVENT_TYPES, FinanceEvents } from "../../domain/events";
import {
  FEE_CATEGORIES,
  FUNDING_TYPES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  ALLOCATION_ORDERS,
} from "../../domain/types";
import { CURRENCIES } from "@ecoledigitale/kernel";
import * as publicApi from "../../index";

const here = fileURLToPath(new URL(".", import.meta.url));
const migrationsDir = resolve(here, "../../migrations");
const sqlOf = (file: string): string => readFileSync(resolve(migrationsDir, file), "utf8");
const allSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map(sqlOf)
  .join("\n");

describe("manifeste", () => {
  it("clé = schéma = dossier ; pack CORE ; dépend de rbac", () => {
    expect(manifest.key).toBe("finance");
    expect(manifest.packs).toEqual(["CORE"]);
    expect(manifest.dependsOn).toEqual(["rbac"]);
  });

  it("permissions de la spécification, au format ressource.action", () => {
    expect(manifest.permissions.map((p) => p.key).sort()).toEqual(
      [
        "finance.fee.read",
        "finance.fee.manage",
        "finance.invoice.read",
        "finance.invoice.create",
        "finance.invoice.cancel",
        "finance.payment.read",
        "finance.payment.create",
        "finance.payment.refund",
        "finance.payment.reconcile",
        "finance.provider.manage",
        "finance.cashregister.open",
        "finance.cashregister.close",
        "finance.report.read",
        "finance.receipt.read",
        "finance.child.read",
        "finance.child.pay",
        "finance.self.read",
        "finance.self.pay",
        "finance.webhook.read",
        "finance.webhook.replay",
      ].sort(),
    );
    expect(manifest.permissions.every((p) => p.key.startsWith("finance."))).toBe(true);
  });

  it("événements publiés : tous valides, nommés finance.<entité>.<verbe-passé>, sans doublon", () => {
    expect(manifest.events.publishes).toEqual([...ALL_FINANCE_EVENT_TYPES]);
    expect(new Set(manifest.events.publishes).size).toBe(manifest.events.publishes.length);
    for (const type of manifest.events.publishes) {
      expect(isValidEventType(type), type).toBe(true);
      expect(type, type).toMatch(/^finance\.[a-z_]+\.(issued|paid|overdue|cancelled|initiated|completed|failed|allocated|requested|rejected|opened|closed|submitted|reconciliation_needed)$/);
    }
    for (const required of ["finance.invoice.issued", "finance.payment.completed", "finance.invoice.overdue", "finance.refund.completed"]) {
      expect(manifest.events.publishes).toContain(required);
    }
    expect(Object.values(FinanceEvents)).toEqual(manifest.events.publishes);
  });

  it("s'assemble avec le module rbac (ordre topologique, pas de collision de permissions)", () => {
    const order = resolveModuleOrder([manifest, rbacManifest]).map((m) => m.key);
    expect(order.indexOf("rbac")).toBeLessThan(order.indexOf("finance"));
  });

  it("menus : un par portail admin, référencent des permissions déclarées", () => {
    expect(manifest.menus.length).toBeGreaterThanOrEqual(4);
    const perms = new Set(manifest.permissions.map((p) => p.key));
    for (const m of manifest.menus) {
      expect(perms.has(m.permission)).toBe(true);
      if (m.portal === "admin") expect(m.href.startsWith("/admin/finance") || m.href.startsWith("/v2/finance")).toBe(true); // `/v2/finance/*` : écrans v2 (ex. paiements à rapprocher)
      else expect(["parent", "student"]).toContain(m.portal); // portails famille : `finance.child.read` / `finance.self.read`
    }
    expect(manifest.menus.filter((m) => m.portal === "admin").length).toBeGreaterThanOrEqual(4);
  });
});

describe("API publique (index.ts)", () => {
  it("expose manifeste, plugin, dépendances, ports et cas d'usage", () => {
    for (const name of [
      "financeManifest",
      "financePlugin",
      "createFinanceDeps",
      "createProviderRegistry",
      "SandboxProvider",
      "recordManualPayment",
      "initiateOnlinePayment",
      "handleProviderWebhook",
      "issueInvoiceFromSchedule",
      "generateInstallmentPlan",
      "requestRefund",
      "approveRefund",
      "issueCreditNote",
      "openCashSession",
      "closeCashSession",
      "getFinanceSummary",
      "getAgedBalance",
      "markOverdueInvoices",
      "noopAudit",
      "passThroughLearners",
    ]) {
      expect((publicApi as Record<string, unknown>)[name], name).toBeDefined();
    }
  });
});

describe("migrations", () => {
  it("fichiers dans la plage réservée 0500-0599, chargeables par le runner", () => {
    const files = loadMigrations([migrationsDir]);
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      expect(Number(f.version), f.filename).toBeGreaterThanOrEqual(500);
      expect(Number(f.version), f.filename).toBeLessThanOrEqual(599);
    }
  });

  it("chaque table du schéma est une table de tenant : tenant_id uuid NOT NULL REFERENCES kernel.tenants + RLS + grant", () => {
    const tables = [...allSql.matchAll(/CREATE TABLE finance\.(\w+)\s*\(([\s\S]*?)\n\);/g)];
    expect(tables.map((m) => `finance.${m[1]}`).sort()).toEqual([...financeTenantTables].sort());
    for (const [, name, body] of tables) {
      expect(body, name).toMatch(/tenant_id\s+uuid\s+NOT NULL REFERENCES kernel\.tenants \(id\)/);
      expect(allSql, name).toContain(`kernel.enable_tenant_rls('finance.${name}')`);
      expect(allSql, name).toMatch(new RegExp(`GRANT [A-Z, ()a-z_]+ ON finance\\.${name} TO app_user`));
    }
  });

  it("aucun montant en flottant ou numeric ; les montants sont des bigint", () => {
    expect(allSql).not.toMatch(/\b(real|double precision|float\d?|numeric|decimal|money)\b\s*(,|\)|NOT|DEFAULT|CHECK|$)/im);
    const amountColumns = [...allSql.matchAll(/^\s+(\w*(?:amount|float))\s+(\w+)/gim)].filter(([, , type]) => !/^(text|boolean)$/i.test(type!));
    expect(amountColumns.length).toBeGreaterThan(20);
    for (const [, col, type] of amountColumns) expect(type!.toLowerCase(), col).toBe("bigint");
  });

  it("aucune clé étrangère vers un autre schéma que kernel.tenants", () => {
    const refs = [...allSql.matchAll(/REFERENCES\s+([\w.]+)/g)].map((m) => m[1]!);
    for (const r of refs) expect(r === "kernel.tenants" || r.startsWith("finance."), r).toBe(true);
  });

  it("les énumérations SQL (CHECK … IN (…)) correspondent aux constantes du domaine", () => {
    const listIn = (column: string): string[] => {
      const m = new RegExp(`${column}\\s+text[^,]*?CHECK \\(${column} IN \\(([^)]*)\\)`, "i").exec(allSql);
      if (!m) throw new Error(`énumération introuvable pour ${column}`);
      return [...m[1]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]!);
    };
    expect(listIn("category").sort()).toEqual([...FEE_CATEGORIES].sort());
    expect(listIn("method").sort()).toEqual([...PAYMENT_METHODS].sort());
    expect(listIn("funding_type").sort()).toEqual([...FUNDING_TYPES].sort());
    // statuts : plusieurs tables portent `status` — on vérifie celles de facture, paiement, remboursement
    const invoiceStatuses = /CREATE TABLE finance\.invoices[\s\S]*?status\s+text[^;]*?CHECK \(status IN \(([^)]*)\)/.exec(allSql)![1]!;
    expect([...invoiceStatuses.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...INVOICE_STATUSES].sort());
    const paymentStatuses = /CREATE TABLE finance\.payments[\s\S]*?status\s+text[^;]*?CHECK \(status IN \(([^)]*)\)/.exec(allSql)![1]!;
    expect([...paymentStatuses.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...PAYMENT_STATUSES].sort());
    // Les états d'un remboursement ont été étendus par la migration 0506 (contrainte nommée) : c'est elle qui fait foi.
    const refundStatuses = /ADD CONSTRAINT refunds_status_check\s+CHECK \(status IN \(([^)]*)\)/.exec(allSql)![1]!;
    expect([...refundStatuses.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...REFUND_STATUSES].sort());
    expect([...allSql.matchAll(/currency IN \(([^)]*)\)/g)].every((m) => [...m[1]!.matchAll(/'([A-Z]+)'/g)].map((x) => x[1]).sort().join() === Object.keys(CURRENCIES).sort().join())).toBe(true);
  });

  it("les transitions SQL des factures et des paiements reprennent la table du domaine", async () => {
    const { INVOICE_TRANSITIONS } = await import("../../domain/invoice");
    const { PAYMENT_TRANSITIONS } = await import("../../domain/payment");
    const guards = sqlOf("0503_finance_guards.sql");
    for (const [from, tos] of Object.entries(INVOICE_TRANSITIONS)) {
      if (from === "DRAFT" || tos.length === 0) continue;
      const m = new RegExp(`WHEN '${from}'\\s+THEN NEW\\.status IN \\(([^)]*)\\)`).exec(guards);
      expect(m, from).not.toBeNull();
      const sqlTos = [...m![1]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]!).filter((s) => s !== from);
      expect(sqlTos.sort(), from).toEqual([...tos].sort());
    }
    expect(guards).toContain("OLD.status = 'PENDING' AND NEW.status IN ('CONFIRMED', 'FAILED')");
    expect(PAYMENT_TRANSITIONS.PENDING).toEqual(["CONFIRMED", "FAILED"]);
    expect(guards).toContain("OLD.status = 'CONFIRMED' AND NEW.status = 'REFUNDED'");
    expect(PAYMENT_TRANSITIONS.CONFIRMED).toEqual(["REFUNDED"]);
  });
});

describe("liste blanche d'isolation", () => {
  it("aucune table globale : tout le schéma est soumis à la RLS de tenant", () => {
    expect(financeIsolationAllowlist).toEqual([]);
    expect(financeAllowlist).toBe(financeIsolationAllowlist);
    expect(new Set(financeTenantTables).size).toBe(financeTenantTables.length);
    expect(financeTenantTables.every((t) => t.startsWith("finance."))).toBe(true);
  });
});

describe("contrats Zod (packages/contracts/src/v2/finance.ts)", () => {
  it("réexportés par l'index v2 sans collision de noms", () => {
    expect((contractsV2 as Record<string, unknown>).financeCreateFeeBodySchema).toBeDefined();
    expect((contractsV2 as Record<string, unknown>).rbacRoleSummarySchema).toBeDefined();
  });

  it("énumérations du contrat = constantes du domaine", () => {
    expect([...FINANCE_FEE_CATEGORIES]).toEqual([...FEE_CATEGORIES]);
    expect([...FINANCE_FUNDING_TYPES]).toEqual([...FUNDING_TYPES]);
    expect([...FINANCE_PAYMENT_METHODS]).toEqual([...PAYMENT_METHODS]);
    expect([...FINANCE_INVOICE_STATUSES]).toEqual([...INVOICE_STATUSES]);
    expect([...FINANCE_PAYMENT_STATUSES]).toEqual([...PAYMENT_STATUSES]);
    expect([...FINANCE_REFUND_STATUSES]).toEqual([...REFUND_STATUSES]);
    expect([...FINANCE_CURRENCIES].sort()).toEqual(Object.keys(CURRENCIES).sort());
    expect(financeAllocationSpecSchema.safeParse({ mode: "AUTO", order: ALLOCATION_ORDERS[4] }).success).toBe(true);
  });

  it("montants en entrée : entiers ou chaînes de chiffres uniquement", () => {
    for (const ok of [0, 1500, "1500", "000", Number.MAX_SAFE_INTEGER]) expect(financeAmountSchema.safeParse(ok).success, String(ok)).toBe(true);
    for (const ko of [1.5, -1, "1.5", "-3", "1e5", "", " 12", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "9".repeat(16), null, undefined, {}]) {
      expect(financeAmountSchema.safeParse(ko).success, String(ko)).toBe(false);
    }
  });

  it("un paiement exige un montant > 0, un mode manuel et refuse les champs inconnus", () => {
    const base = { learnerId: "0192f7a0-0000-7000-8000-000000000001", amount: 1000, method: "CASH" };
    expect(financeRecordPaymentBodySchema.safeParse(base).success).toBe(true);
    expect(financeRecordPaymentBodySchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(financeRecordPaymentBodySchema.safeParse({ ...base, amount: "0" }).success).toBe(false);
    expect(financeRecordPaymentBodySchema.safeParse({ ...base, method: "ONLINE" }).success).toBe(false);
    expect(financeRecordPaymentBodySchema.safeParse({ ...base, status: "CONFIRMED" }).success).toBe(false);
    expect(financeRecordPaymentBodySchema.safeParse({ ...base, learnerId: "pas-un-uuid" }).success).toBe(false);
  });

  it("facture depuis barème : feeId OU feeCode ; barème : dates ISO", () => {
    const learnerId = "0192f7a0-0000-7000-8000-000000000001";
    expect(financeInvoiceFromScheduleBodySchema.safeParse({ learnerId, items: [{ feeCode: "SCOL" }] }).success).toBe(true);
    expect(financeInvoiceFromScheduleBodySchema.safeParse({ learnerId, items: [{}] }).success).toBe(false);
    expect(financeInvoiceFromScheduleBodySchema.safeParse({ learnerId, items: [{ feeCode: "A", feeId: learnerId }] }).success).toBe(false);
    expect(financeInvoiceFromScheduleBodySchema.safeParse({ learnerId, items: [] }).success).toBe(false);
    const sched = { feeId: learnerId, academicYear: "2025-2026", amount: 1, effectiveFrom: "2025-06-01" };
    expect(financeCreateFeeScheduleBodySchema.safeParse(sched).success).toBe(true);
    expect(financeCreateFeeScheduleBodySchema.safeParse({ ...sched, effectiveFrom: "01/06/2025" }).success).toBe(false);
  });

  it("clé d'idempotence et paramètres de webhook", () => {
    expect(financeIdempotencyKeySchema.safeParse("pay-2026-000001").success).toBe(true);
    expect(financeIdempotencyKeySchema.safeParse("court").success).toBe(false);
    expect(financeWebhookParamsSchema.safeParse({ provider: "wave", tenantId: "0192f7a0-0000-7000-8000-000000000001" }).success).toBe(true);
    expect(financeWebhookParamsSchema.safeParse({ provider: "Wave!", tenantId: "x" }).success).toBe(false);
  });
});
