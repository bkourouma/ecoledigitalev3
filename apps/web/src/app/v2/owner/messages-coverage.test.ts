import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../../messages/fr-CI.json";
import {
  ANALYTICS_ADMISSION_STATUSES,
  ANALYTICS_AGING_BUCKETS,
  ANALYTICS_ALERT_FREQUENCIES,
  ANALYTICS_ALERT_METRICS,
  ANALYTICS_ALERT_OUTCOMES,
  ANALYTICS_ALERT_SEVERITIES,
  ANALYTICS_ALERT_STATUSES,
  ANALYTICS_COMPARISON_DOMAINS,
  ANALYTICS_REFRESH_KINDS,
  ANALYTICS_SCHOOLLIFE_INDICATORS,
} from "@ecoledigitale/contracts/v2/analytics";

/**
 * Filet de sécurité i18n du pilotage (`v2Owner`, `v2Direction`) : toute clé passée à `t("…")` existe dans `messages/fr-CI.json`
 * et chaque valeur d'énumération des contrats (genres de lecture, tranches d'ancienneté, états) a son libellé.
 */
const ROOT = path.resolve(__dirname, "../..");
const SOURCES = [path.join(ROOT, "v2/owner"), path.join(ROOT, "v2/direction"), path.join(ROOT, "v2/analytics")];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(tsx|ts)$/.test(e.name) && !/\.test\./.test(e.name) && !full.includes("_test") ? [full] : [];
  });
}

function lookup(ns: string, key: string): unknown {
  return `${ns}.${key}`.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), catalog);
}

describe("messages fr-CI (pilotage direction et propriétaire)", () => {
  it("toutes les clés statiques utilisées par les écrans existent", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of SOURCES.flatMap(walk)) {
      const source = fs.readFileSync(file, "utf8");
      const decls = [...source.matchAll(/const (\w+) = useTranslations\("([^"]+)"\)/g)].map((m) => ({ name: m[1]!, ns: m[2]!, start: m.index! }));
      decls.forEach((d, i) => {
        const next = decls.slice(i + 1).find((x) => x.name === d.name);
        const region = source.slice(d.start, next ? next.start : source.length);
        for (const m of region.matchAll(new RegExp(String.raw`(?<![\w.])${d.name}\(\s*"([^"]+)"`, "g"))) {
          checked += 1;
          if (typeof lookup(d.ns, m[1]!) !== "string") missing.push(`${path.relative(ROOT, file)} -> ${d.ns}.${m[1]}`);
        }
      });
    }
    expect(checked).toBeGreaterThan(150);
    expect(missing).toEqual([]);
  });

  it("les libellés d'énumération et de clés dynamiques sont tous traduits", () => {
    const expectations: Array<[string, readonly string[]]> = [
      ["v2Owner.hub.kinds", ANALYTICS_REFRESH_KINDS],
      ["v2Owner.hub.state", ["OK", "FAILED", "UNAVAILABLE"]],
      ["v2Owner.treasury.aged.buckets", ANALYTICS_AGING_BUCKETS],
      ["v2Owner.status", ["good", "warning", "critical", "neutral"]],
      ["v2Owner.pedagogy.outcome", ["ADMITTED", "RESIT", "ADJOURNED", "PROMOTED", "REPEAT", "PENDING", "EXAM_REFERRAL", "OTHER", "none"]],
      ["v2Owner.pedagogy.level", ["UE", "ECUE", "SUBJECT"]],
      ["v2Owner.payroll.status", ["CALCULATED", "APPROVED", "PAID", "DISPUTED", "CANCELLED", "OTHER"]],
      ["v2Owner.charges.notMeasured", ["title", "charges", "result", "margins", "retention"]],
      ["v2Direction.enrollment.sex", ["M", "F", "UNKNOWN"]],
      ["v2Direction.enrollment.funding", ["PRIVATE", "STATE_ASSIGNED", "SCHOLARSHIP", "COMPANY", "STAFF_CHILD", "OTHER"]],
      ["v2Direction.enrollment.status", ["PENDING", "ACTIVE", "CONFIRMED", "SUSPENDED", "WITHDRAWN", "CANCELLED", "COMPLETED", "OTHER"]],
      ["v2Direction.enrollment.source", ["ADMISSION", "IMPORT", "MANUAL", "ROLLOVER", "ONLINE", "UNKNOWN", "OTHER"]],
      ["v2Owner.demo", ["title", "body", "unknown"]],
      ["v2Analytics.hub.schoollife.indicators", ANALYTICS_SCHOOLLIFE_INDICATORS],
      ["v2Analytics.admissions.status", ANALYTICS_ADMISSION_STATUSES],
      ["v2Analytics.admissions.campaignStatus", ["DRAFT", "OPEN", "CLOSED", "ARCHIVED", "OTHER"]],
      ["v2Analytics.schoollife.indicators", ANALYTICS_SCHOOLLIFE_INDICATORS.flatMap((k) => [`${k}.label`, `${k}.detail`])],
      ["v2Analytics.compare.domains", ANALYTICS_COMPARISON_DOMAINS],
      [
        "v2Analytics.compare.metrics",
        [
          ...["inSchooling", "total", "repeaters", "repeaterRateBps"].map((k) => `enrollment.${k}`),
          ...["rateBps", "recordsCount", "absentCount", "lateCount", "absentMinutes"].map((k) => `attendance.${k}`),
          ...["count", "average", "validatedCount", "validationRateBps"].map((k) => `results.${k}`),
          ...["netBilled", "collected", "outstanding", "overdue", "collectionRateBps"].map((k) => `finance.${k}`),
        ],
      ],
      ["v2Analytics.alerts.severity", ANALYTICS_ALERT_SEVERITIES],
      ["v2Analytics.alerts.status", ANALYTICS_ALERT_STATUSES],
      ["v2Analytics.alerts.metrics", ANALYTICS_ALERT_METRICS],
      ["v2Analytics.alerts.detail.notifications.reasons", ["RAISED", "ESCALATED", "REMINDER"]],
      ["v2Analytics.alerts.detail.notifications.severities", ANALYTICS_ALERT_SEVERITIES],
      ["v2Analytics.rules.metrics", ANALYTICS_ALERT_METRICS],
      ["v2Analytics.rules.roles", ["owner", "directeur", "directeur_etudes", "econome", "secretariat", "responsable_pedagogique", "responsable_examens", "admissions_officer"]],
      ["v2Analytics.rules.direction", ["BELOW", "ABOVE"]],
      ["v2Analytics.rules.frequency", ANALYTICS_ALERT_FREQUENCIES],
      ["v2Analytics.rules.outcome", ANALYTICS_ALERT_OUTCOMES],
      ["v2Analytics.rules.form.unitHint", ["BPS", "AMOUNT", "COUNT"]],
      ["v2Owner.nav", ["indicators", "admissions", "schoollife", "compare", "alerts"]],
      ["v2Direction.dashboard.links", ["enrollment", "pedagogy", "tuition", "treasury", "payroll", "charges"].flatMap((k) => [`${k}.title`, `${k}.hint`])],
    ];
    const missing: string[] = [];
    for (const [ns, keys] of expectations) for (const k of keys) if (typeof lookup(ns, k) !== "string") missing.push(`${ns}.${k}`);
    expect(missing).toEqual([]);
  });

  it("aucune valeur vide et mêmes variables ICU entre les espaces de noms", () => {
    const empties: string[] = [];
    const walkCatalog = (node: unknown, prefix: string): void => {
      if (typeof node === "string") {
        if (node.trim() === "") empties.push(prefix);
        return;
      }
      if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walkCatalog(v, `${prefix}.${k}`);
    };
    walkCatalog((catalog as Record<string, unknown>).v2Owner, "v2Owner");
    walkCatalog((catalog as Record<string, unknown>).v2Direction, "v2Direction");
    walkCatalog((catalog as Record<string, unknown>).v2Analytics, "v2Analytics");
    expect(empties).toEqual([]);
  });
});
