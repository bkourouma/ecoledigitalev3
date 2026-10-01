import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../../messages/fr-CI.json";
import {
  FINANCE_AGING_BUCKETS,
  FINANCE_CURRENCIES,
  FINANCE_FEE_CATEGORIES,
  FINANCE_FUNDING_TYPES,
  FINANCE_INVOICE_STATUSES,
  FINANCE_PAYMENT_METHODS,
  FINANCE_PAYMENT_STATUSES,
  FINANCE_REFUND_STATUSES,
} from "@ecoledigitale/contracts/v2/finance";
import {
  PAYROLL_CONFIG_TYPES,
  PAYROLL_HOUR_SOURCES,
  PAYROLL_PAYMENT_METHODS,
  PAYROLL_PAYSLIP_STATUSES,
  PAYROLL_PERIOD_STATUSES,
  PAYROLL_RATE_ORIGINS,
  PAYROLL_SKIP_REASONS,
} from "@ecoledigitale/contracts/v2/payroll";

/**
 * Filet de sécurité i18n des écrans finance et paie : toute clé passée à `t("…")` doit exister dans `messages/fr-CI.json`
 * et chaque valeur d'énumération des contrats doit avoir son libellé.
 */

/** Préfixes dont le lot n'est pas encore livré (retirés au fil des lots) : le test les exige dès qu'ils sont retirés. */
const PENDING: string[] = ["v2Payroll"];

const ROOT = path.resolve(__dirname, "../..");
const SOURCES = [path.join(ROOT, "app/v2/finance"), path.join(ROOT, "app/v2/payroll")];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(tsx|ts)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
  });
}

function lookup(ns: string, key: string): unknown {
  return `${ns}.${key}`.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), catalog);
}

describe("messages fr-CI (finance et paie)", () => {
  it("toutes les clés statiques utilisées par les écrans existent", () => {
    const missing: string[] = [];
    for (const file of SOURCES.flatMap(walk)) {
      const source = fs.readFileSync(file, "utf8");
      const decls = [...source.matchAll(/const (\w+) = useTranslations\("([^"]+)"\)/g)].map((m) => ({ name: m[1]!, ns: m[2]!, start: m.index! }));
      decls.forEach((d, i) => {
        const next = decls.slice(i + 1).find((x) => x.name === d.name);
        const region = source.slice(d.start, next ? next.start : source.length);
        for (const m of region.matchAll(new RegExp(String.raw`(?<![\w.])${d.name}\(\s*"([^"]+)"`, "g"))) {
          if (typeof lookup(d.ns, m[1]!) !== "string") missing.push(`${path.relative(ROOT, file)} -> ${d.ns}.${m[1]}`);
        }
      });
    }
    expect(missing).toEqual([]);
  });

  it("les libellés d'énumération sont tous traduits", () => {
    const expectations: Array<[string, readonly string[]]> = [
      ["v2Finance.category", FINANCE_FEE_CATEGORIES],
      ["v2Finance.funding.type", FINANCE_FUNDING_TYPES],
      ["v2Finance.invoiceForm.categories", FINANCE_FEE_CATEGORIES],
      ["v2Finance.reports.summary.cards", ["billed", "credited", "netBilled", "collected", "outstanding", "overdue", "unallocated", "rate"]],
      ["v2Finance.reports.anchors", ["groups", "learners", "aged", "trend"]],
      ["v2Finance.reports.trend.granularity", ["day", "week", "month"]],
      ["v2Finance.overview.links", ["collect", "invoice", "cash", "reports", "overdue", "refunds"].flatMap((k) => [`${k}.title`, `${k}.hint`])],
      ["v2Finance.allocation.modes", ["AUTO", "MANUAL", "NONE"]],
      ["v2Finance.allocation.hints", ["AUTO", "MANUAL", "NONE"]],
      ["v2Finance.paymentForm.confirm.modes", ["AUTO", "MANUAL", "NONE"]],
      ["v2Finance.onlineForm.providers", ["orange_money", "mtn_momo", "wave", "cinetpay", "tresorpay", "other"]],
      ["v2Finance.invoiceForm.scope", ["levelKey", "trackKey", "learnerType"]],
      ["v2Finance.invoiceForm.mode", ["catalog", "manual", "catalogHint", "manualHint"]],
      ["v2Finance.invoiceForm.preview.totals", ["subtotal", "discount", "scholarship", "total"]],
      ["v2Finance.invoiceDetail.amounts", ["subtotal", "discount", "scholarship", "total", "paid", "credited", "balance"]],
      ["v2Finance.catalog.discounts.form.percentErrors", ["empty", "invalid", "range"]],
      ["v2Finance.funding.scholarshipDialog.percentErrors", ["empty", "invalid", "range"]],
      ["v2Finance.method", FINANCE_PAYMENT_METHODS],
      ["v2Finance.status.invoice", FINANCE_INVOICE_STATUSES],
      ["v2Finance.status.payment", FINANCE_PAYMENT_STATUSES],
      ["v2Finance.status.refund", FINANCE_REFUND_STATUSES],
      ["v2Finance.status.installment", ["PENDING", "PARTIALLY_PAID", "PAID", "OVERDUE", "CREDITED"]],
      ["v2Finance.status.scholarship", ["ACTIVE", "SUSPENDED", "ENDED"]],
      ["v2Finance.status.cashSession", ["OPEN", "CLOSED"]],
      ["v2Finance.aging", FINANCE_AGING_BUCKETS],
      ["v2Finance.funder", ["STATE", "COMPANY", "INSTITUTION", "FOUNDATION", "OTHER"]],
      ["v2Finance.payer", ["LEARNER", "FUNDER"]],
      ["v2Finance.allocationOrder", ["OLDEST_DUE_FIRST", "NEWEST_DUE_FIRST", "SMALLEST_REMAINING_FIRST", "LARGEST_REMAINING_FIRST", "PROPORTIONAL"]],
      ["v2Finance.currency", FINANCE_CURRENCIES],
      ["v2Payroll.status.payslip", PAYROLL_PAYSLIP_STATUSES],
      ["v2Payroll.status.period", PAYROLL_PERIOD_STATUSES],
      ["v2Payroll.configType", PAYROLL_CONFIG_TYPES],
      ["v2Payroll.source", PAYROLL_HOUR_SOURCES],
      ["v2Payroll.method", PAYROLL_PAYMENT_METHODS],
      ["v2Payroll.rateOrigin", PAYROLL_RATE_ORIGINS],
      ["v2Payroll.skipReason", PAYROLL_SKIP_REASONS],
      ["v2Payroll.outcome", ["CALCULATED", "SKIPPED", "LOCKED", "FAILED"]],
      ["v2Payroll.configState", ["ACTIVE", "EXPIRED", "FUTURE", "ABSENT"]],
      ["v2Payroll.scope", ["ALL", "SESSION", "ATTENDANCE"]],
      ["v2Payroll.adjustmentKind", ["BONUS", "DEDUCTION"]],
    ];
    const missing: string[] = [];
    for (const [ns, values] of expectations) for (const v of values) if (typeof lookup(ns, v) !== "string") missing.push(`${ns}.${v}`);
    expect(missing.filter((m) => !PENDING.some((p) => m.startsWith(p)))).toEqual([]);
  });
});
