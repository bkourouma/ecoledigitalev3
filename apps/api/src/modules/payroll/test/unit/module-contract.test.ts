/**
 * Contrat du module (conventions de modules, spec 032 §11) : manifeste, plage de migrations 1500-1599, contrat de
 * plugin `(app, runtime)`, chargement PAR LE REGISTRE, abonnés/jobs découvrables, API publique, registre de ports.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { resolveModuleOrder } from "@ecoledigitale/kernel";
import manifest from "../../manifest";
import { ALL_PAYROLL_EVENT_TYPES, CONSUMED_EVENT_TYPES, PayrollEvents } from "../../domain/events";
import * as publicApi from "../../index";
import plugin, { payrollPlugin, registerPayrollPorts, setup } from "../../http/plugin";
import jobs from "../../jobs";
import subscribers from "../../subscribers";
import allowlist, { payrollTenantTables } from "../../../isolation-allowlist.payroll";
import { inMemoryPorts } from "../../infrastructure/in-memory-ports";

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = resolve(here, "../..");
const modulesDir = resolve(moduleDir, "..");

describe("manifeste", () => {
  it("clé, packs, dépendance rbac, permissions de la spec (sensibles marquées), features, menus", () => {
    expect(manifest.key).toBe("payroll");
    expect(manifest.dependsOn).toEqual(["rbac"]);
    expect(manifest.packs).toEqual(["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"]);
    const keys = manifest.permissions.map((p) => p.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "payroll.settings.manage",
        "payroll.config.read",
        "payroll.config.manage",
        "payroll.rate.read",
        "payroll.rate.manage",
        "payroll.period.manage",
        "payroll.run.calculate",
        "payroll.payslip.read",
        "payroll.payslip.read_own",
        "payroll.payslip.adjust",
        "payroll.payslip.approve",
        "payroll.payslip.approve_owner",
        "payroll.payslip.pay",
        "payroll.payslip.cancel",
        "payroll.payslip.notify",
        "payroll.report.read",
      ]),
    );
    expect(keys.every((k) => k.startsWith("payroll."))).toBe(true);
    // approuver / verser / annuler / lire tous les bulletins : sensibles (MFA, audit) ; lire SES bulletins : non
    const sensitive = new Set(manifest.permissions.filter((p) => p.sensitive).map((p) => p.key));
    for (const k of ["payroll.payslip.approve", "payroll.payslip.approve_owner", "payroll.payslip.pay", "payroll.payslip.cancel", "payroll.payslip.read", "payroll.payslip.adjust", "payroll.settings.manage"]) expect(sensitive.has(k), k).toBe(true);
    expect(sensitive.has("payroll.payslip.read_own")).toBe(false);
    expect(manifest.features.map((f) => f.key).sort()).toEqual(["payroll.attendance-source", "payroll.core", "payroll.owner-validation", "payroll.session-source"]);
    // Q-36 : sources d'heures par pack
    const packsOf = (key: string) => manifest.features.find((f) => f.key === key)?.packs;
    expect(packsOf("payroll.session-source")).toEqual(["HIGHER", "VIRTUAL"]);
    expect(packsOf("payroll.attendance-source")).toEqual(["PRIMARY", "SECONDARY"]);
    // chaque menu pointe une permission et une feature du module
    for (const m of manifest.menus) {
      expect(keys).toContain(m.permission);
      if (m.feature) expect(manifest.features.map((f) => f.key)).toContain(m.feature);
    }
  });

  it("publie exactement les événements du module et consomme ceux de la spec", () => {
    expect([...manifest.events.publishes].sort()).toEqual([...ALL_PAYROLL_EVENT_TYPES].sort());
    expect(manifest.events.publishes.every((t) => /^payroll\.[a-z_]+\.[a-z_]+$/.test(t))).toBe(true);
    expect([...manifest.events.consumes].sort()).toEqual([...CONSUMED_EVENT_TYPES].sort());
    for (const required of [PayrollEvents.periodCreated, PayrollEvents.runCompleted, PayrollEvents.payslipCalculated, PayrollEvents.payslipApproved, PayrollEvents.payslipPaid, PayrollEvents.payslipDisputed, PayrollEvents.payslipCancelled, PayrollEvents.claimSourceChanged]) {
      expect(manifest.events.publishes).toContain(required);
    }
  });

  it("est cohérent avec le registre (ordre topologique avec rbac, pas de doublon)", () => {
    const rbac = { key: "rbac", title: "rbac", packs: ["CORE"] as const, dependsOn: [], permissions: [], features: [], menus: [], events: { publishes: [], consumes: [] } };
    expect(resolveModuleOrder([manifest, rbac as never]).map((m) => m.key)).toEqual(["rbac", "payroll"]);
  });
});

describe("migrations : plage 1500-1599 réservée au module", () => {
  const files = readdirSync(join(moduleDir, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const sql = files.map((f) => readFileSync(join(moduleDir, "migrations", f), "utf8")).join("\n");

  it("tous les fichiers sont dans la plage, numérotés sans trou, en minuscules", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const m = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(f);
      expect(m, f).not.toBeNull();
      const n = Number(m?.[1]);
      expect(n).toBeGreaterThanOrEqual(1500);
      expect(n).toBeLessThanOrEqual(1599);
    }
    const numbers = files.map((f) => Number(f.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, i) => 1500 + i));
  });

  it("chaque table est dans le schéma `payroll` avec tenant_id + RLS + droits, et la liste d'isolation est complète", () => {
    const created = [...sql.matchAll(/CREATE TABLE (payroll\.[a-z_]+)/g)].map((m) => m[1] as string).sort();
    const rls = [...sql.matchAll(/kernel\.enable_tenant_rls\('(payroll\.[a-z_]+)'\)/g)].map((m) => m[1] as string).sort();
    expect(created).toEqual(rls);
    expect(created).toEqual([...payrollTenantTables].sort());
    expect(created).toHaveLength(13);
    expect(sql).not.toMatch(/CREATE TABLE (?!payroll\.)/);
    // aucune table globale justifiée : toutes sont des tables de tenant
    expect(allowlist).toEqual([]);
    for (const t of created) {
      expect(new RegExp(`GRANT [A-Z, ]+ ON ${t.replace(".", "\\.")} TO app_user`).test(sql), `GRANT ${t}`).toBe(true);
      const block = sql.slice(sql.indexOf(`CREATE TABLE ${t} `));
      expect(block.slice(0, block.indexOf(");")), t).toContain("tenant_id");
    }
  });

  it("aucune clé étrangère vers un autre schéma que kernel.tenants ; aucun montant en décimal/flottant", () => {
    const refs = [...sql.matchAll(/REFERENCES\s+([a-z_]+)\.([a-z_]+)/g)].map((m) => `${m[1]}.${m[2]}`);
    for (const r of refs) expect(["kernel.tenants", "payroll.pay_periods", "payroll.pay_configs", "payroll.payslips", "payroll.calculation_runs"], r).toContain(r);
    expect(sql).not.toMatch(/numeric\s*\(|double precision|\bfloat\b|\breal\b|\bmoney\b/i);
    expect(sql).toMatch(/total_amount\s+bigint/);
  });
});

describe("contrat de plugin `(app, runtime)`", () => {
  it("l'export par défaut de http/plugin.ts est une fonction à deux paramètres ; `setup` aussi", () => {
    expect(typeof plugin).toBe("function");
    expect(plugin.length).toBe(2);
    expect(typeof setup).toBe("function");
    expect(setup.length).toBe(2);
    expect(typeof payrollPlugin).toBe("function");
  });

  it("le registre de ports se pose sur l'instance racine et se complète dans n'importe quel ordre (`registerPayrollPorts(app, ports)`)", async () => {
    const app = Fastify({ logger: false });
    setup(app, undefined as never);
    expect(app.hasDecorator("payrollPorts")).toBe(true);
    expect(app.payrollPorts.current.sessionHours).toBeNull();
    const mem = inMemoryPorts();
    registerPayrollPorts(app, { staff: mem.staff });
    registerPayrollPorts(app, { sessionHours: mem.sessions });
    expect(app.payrollPorts.current.staff).toBe(mem.staff);
    expect(app.payrollPorts.current.sessionHours).toBe(mem.sessions);
    expect(app.payrollPorts.current.attendanceHours).toBeNull();
    // un fournisseur qui s'enregistre avant `setup` fonctionne aussi (le décorateur est créé à la demande)
    const early = Fastify({ logger: false });
    registerPayrollPorts(early, { attendanceHours: mem.attendance });
    expect(early.payrollPorts.current.attendanceHours).toBe(mem.attendance);
    await app.close();
    await early.close();
  });

  it("le module expose abonnés et jobs découvrables par le worker, aux noms uniques", () => {
    const names = [...subscribers.map((s) => s.name), ...jobs.map((j) => j.name)];
    expect(new Set(names).size).toBe(names.length);
    expect(subscribers.map((s) => s.pattern).sort()).toEqual([...CONSUMED_EVENT_TYPES].sort());
    expect(jobs.map((j) => j.name)).toEqual(["payroll.fail-stale-runs"]);
    expect(names.every((n) => n.startsWith("payroll."))).toBe(true);
    for (const s of subscribers) expect(typeof s.handler).toBe("function");
  });

  it("l'index public expose les interfaces consommées par l'assemblage, 014/015, 016 et les tests des autres modules", () => {
    for (const fn of [
      "registerPayrollPorts",
      "createPayrollDeps",
      "calculatePeriod",
      "approvePayslips",
      "payPayslips",
      "cancelPayslip",
      "disputePayslip",
      "adjustPayslip",
      "notifyPayslip",
      "createPeriod",
      "createPayConfig",
      "createHourlyRate",
      "simulateRate",
      "getPayslipDetail",
      "getPayslipData",
      "listPayslips",
      "listHistory",
      "listMyPayslips",
      "reportSummary",
      "ownerMass",
      "exportPayslipsCsv",
      "inMemoryPayrollPorts",
      "computePayslip",
      "isPayable",
      "payrollAuditAdapter",
    ]) {
      expect(typeof (publicApi as Record<string, unknown>)[fn], fn).toBe("function");
    }
    expect(publicApi.PayrollEvents.payslipPaid).toBe("payroll.payslip.paid");
    expect(publicApi.payrollManifest).toBe(manifest);
  });

  it("README et fichiers obligatoires présents", () => {
    for (const f of ["README.md", "manifest.ts", "index.ts", "subscribers.ts", "jobs.ts", "http/plugin.ts", "domain/payability.ts", "domain/calculation.ts"]) {
      expect(existsSync(join(moduleDir, f)), f).toBe(true);
    }
    expect(existsSync(join(modulesDir, "isolation-allowlist.payroll.ts"))).toBe(true);
  });
});
