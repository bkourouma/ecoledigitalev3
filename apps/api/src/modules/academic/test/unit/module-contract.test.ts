import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isValidEventType, resolveModuleOrder } from "@ecoledigitale/kernel";
import * as contractsV2 from "@ecoledigitale/contracts/src/v2";
import { academicEventPayloadSchemas } from "@ecoledigitale/contracts/src/v2/academic";
import manifest from "../../manifest";
import { rbacManifest } from "../../../rbac";
import { manifest as tenancyManifest } from "../../../tenancy";
import allowlist, { academicIsolationAllowlist, academicTenantTables } from "../../../isolation-allowlist.academic";
import { ALL_ACADEMIC_EVENT_TYPES, AcademicEvents, ConsumedEvents } from "../../domain/events";
import { AcademicCode } from "../../domain/errors";
import * as publicApi from "../../index";
import subscribers from "../../subscribers";
import jobs from "../../jobs";

const here = fileURLToPath(new URL(".", import.meta.url));
const moduleDir = resolve(here, "../..");

function walk(dir: string, filter: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(p).isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

const sources = walk(moduleDir, (p) => p.endsWith(".ts") && !p.includes(`${join(moduleDir, "test")}`));
const text = (p: string): string => readFileSync(p, "utf8");
/** Code sans commentaires de ligne ni de bloc. */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("manifeste", () => {
  it("clé = schéma = dossier ; dépend de rbac et tenancy ; s'ordonne avec eux", () => {
    expect(manifest.key).toBe("academic");
    expect(manifest.packs).toEqual(["CORE"]);
    expect(manifest.dependsOn).toEqual(["rbac", "tenancy"]);
    expect(() => resolveModuleOrder([manifest, rbacManifest, tenancyManifest])).not.toThrow();
  });
  it("permissions de la spec §10 (+ academic.year.rollover), format ressource.action, sensibles déclarées", () => {
    const keys = manifest.permissions.map((p) => p.key).sort();
    for (const k of [
      "academic.read", "academic.year.read", "academic.year.manage", "academic.year.close", "academic.period.read", "academic.period.manage", "academic.period.close", "academic.period.reopen",
      "academic.program.read", "academic.program.manage", "academic.classroom.read", "academic.classroom.manage", "academic.settings.manage", "academic.template.apply",
      "curriculum.read", "curriculum.manage", "curriculum.publish", "curriculum.amend",
      "enrollment.read", "enrollment.create", "enrollment.update", "enrollment.cancel", "enrollment.override", "enrollment.confirm.override", "enrollment.self.create", "enrollment.funding.update",
      "enrollment.outcome.record", "enrollment.course.manage", "enrollment.self.read", "enrollment.child.read",
    ]) expect(keys, k).toContain(k);
    expect(new Set(keys).size).toBe(keys.length);
    const sensitive = manifest.permissions.filter((p) => p.sensitive).map((p) => p.key).sort();
    expect(sensitive).toEqual(
      ["academic.period.reopen", "academic.template.apply", "academic.year.close", "academic.year.rollover", "curriculum.amend", "enrollment.confirm.override", "enrollment.funding.update", "enrollment.override"].sort(),
    );
  });
  it("fonctionnalités : à la carte (supérieur), affectés par l'État (secondaire), reconduction (tous)", () => {
    const f = new Map(manifest.features.map((x) => [x.key, x.packs]));
    expect(f.get("academic.a-la-carte")).toEqual(["HIGHER"]);
    expect(f.get("academic.state-assigned")).toEqual(["SECONDARY"]);
    expect(f.get("academic.rollover")).toEqual(["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"]);
  });
  it("menus : permissions déclarées, fonctionnalités déclarées, ordre unique par portail", () => {
    const perms = new Set(manifest.permissions.map((p) => p.key));
    const feats = new Set(manifest.features.map((f) => f.key));
    for (const m of manifest.menus) {
      expect(perms.has(m.permission), m.key).toBe(true);
      if (m.feature) expect(feats.has(m.feature), m.key).toBe(true);
    }
    const keys = manifest.menus.map((m) => `${m.portal}:${m.order}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("événements publiés : valides, sans doublon, `academic.<entité>.<verbe-passé>` ; consommés déclarés", () => {
    expect(manifest.events.publishes).toEqual([...ALL_ACADEMIC_EVENT_TYPES]);
    expect(new Set(manifest.events.publishes).size).toBe(manifest.events.publishes.length);
    for (const t of manifest.events.publishes) {
      expect(isValidEventType(t), t).toBe(true);
      expect(t.startsWith("academic.")).toBe(true);
    }
    expect(manifest.events.consumes).toEqual(expect.arrayContaining([ConsumedEvents.INVOICE_PAID, ConsumedEvents.INSTITUTION_CREATED, ConsumedEvents.STUDENT_STATUS_CHANGED]));
  });
  it("chaque événement publié a un schéma de charge utile versionné dans les contrats", () => {
    expect(Object.keys(academicEventPayloadSchemas).sort()).toEqual([...ALL_ACADEMIC_EVENT_TYPES].sort());
  });
  it("chaque événement publié est réellement émis par au moins un cas d'usage", () => {
    const code = sources.filter((p) => !p.endsWith("domain/events.ts") && !p.endsWith("domain\\events.ts")).map(text).join("\n");
    const unused = Object.entries(AcademicEvents).filter(([key]) => !new RegExp(`AcademicEvents\\.${key}\\b`).test(code));
    // Les événements d'offre et d'inscription passent par les tables d'actions de domain/events.ts.
    const viaTables = new Set(["ENROLLMENT_CONFIRMED", "ENROLLMENT_SUSPENDED", "ENROLLMENT_RESUMED", "ENROLLMENT_WITHDRAWN", "ENROLLMENT_CANCELLED", "ENROLLMENT_COMPLETED", "ENROLLMENT_REOPENED", "OFFERING_STARTED", "OFFERING_COMPLETED", "OFFERING_CANCELLED"]);
    expect(unused.map(([k]) => k).filter((k) => !viaTables.has(k))).toEqual([]);
  });
});

describe("contrats et API publique", () => {
  it("les contrats sont réexportés par v2/index.ts", () => {
    expect(contractsV2).toHaveProperty("academicCreateYearBodySchema");
    expect(contractsV2).toHaveProperty("academicEventPayloadSchemas");
  });
  it("les noms de la spec §7.2 sont exportés, figés", () => {
    const names = [
      "getAcademicYear", "getCurrentAcademicYear", "listAcademicYears", "getAcademicPeriod", "listAcademicPeriods", "resolvePeriodForDate", "getEffectivePeriodState",
      "closePeriodGrading", "closePeriod", "reopenPeriod", "closeClassroomPeriodGrading", "closeClassroomPeriod", "reopenClassroomPeriod",
      "getCurriculumTree", "listCurriculumNodes", "getCurriculumNode", "listNodesForClassroom", "listNodesForEnrollment", "getRuleContext", "getNodePrerequisiteStatus",
      "getClassroom", "listClassrooms", "getRoster", "getOffering", "listOfferings", "checkOfferingEligibility",
      "getEnrollment", "listEnrollments", "listEnrollmentsByStudent", "getEnrollmentHistory", "enrollStudent", "enrollStudentsBulk",
      "recordEnrollmentOutcome", "confirmEnrollmentCourse", "completeEnrollmentCourse", "createEnrollmentDirectory", "selfEnrollToOffering", "reopenOffering",
      "previewRollover", "rolloverAcademicYear", "instantiatePackReferenceData",
      "previewRolloverPlan", "startRolloverRun", "executeRolloverRun", "getRolloverRun", "listRolloverRuns", "retryRolloverRun", "listHolidays", "createHoliday",
      "registerCourse", "listCourseRegistrations", "createAcademicDeps", "academicPlugin", "academicManifest",
      // Extensions Phase 4-5 (specs 005, 006, 007, 018) : additives
      "activateClassroom", "cancelEnrollment", "getEligibilityFacts", "countRepeatsInCycle", "changeEnrollmentFunding", "transferEnrollment", "neverBlockActivation",
      // O-01 / O-10
      "confirmEnrollmentManually", "listNationalHolidays", "setNationalHolidayEnabled", "listEffectiveHolidays",
    ];
    for (const n of names) expect(publicApi, n).toHaveProperty(n);
  });
  it("abonnés et jobs découvrables par le worker", () => {
    expect(subscribers.map((s) => s.name).sort()).toEqual(["academic.confirm-on-invoice-paid", "academic.instantiate-reference-data", "academic.run-rollover", "academic.withdraw-on-student-status"]);
    expect(subscribers.find((s) => s.name === "academic.run-rollover")?.pattern).toBe("academic.rollover.requested");
    expect(subscribers.find((s) => s.name === "academic.confirm-on-invoice-paid")?.pattern).toBe("finance.invoice.paid");
    expect(jobs.map((j) => j.name).sort()).toEqual(["academic.expire-holds", "academic.finalize-offerings"]);
  });
});

describe("migrations 0700-0711", () => {
  const dir = join(moduleDir, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const sql = files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  it("numéros dans la plage réservée 0700-0799, contigus", () => {
    expect(files.map((f) => Number(f.slice(0, 4)))).toEqual([700, 701, 702, 703, 704, 705, 706, 707, 708, 709, 710, 711]);
  });
  it("chaque table du schéma est un tenant : RLS + GRANT, et la liste attendue de l'isolation est exacte (+ la seule table globale allowlistée)", () => {
    const tables = [...sql.matchAll(/CREATE TABLE academic\.(\w+)/g)].map((m) => `academic.${m[1]}`).sort();
    const globals = academicIsolationAllowlist.map((e) => e.table);
    expect(tables).toEqual([...academicTenantTables, ...globals].sort());
    for (const t of tables.filter((x) => !globals.includes(x))) {
      expect(sql, t).toContain(`kernel.enable_tenant_rls('${t}')`);
      expect(sql, t).toMatch(new RegExp(`GRANT [A-Z, ]+ ON ${t.replace(".", "\\.")} TO app_user`));
    }
    // O-10 : UNE table globale, le calendrier national (lecture ouverte, écriture `system` seulement).
    expect(globals).toEqual(["academic.national_holidays"]);
    expect(allowlist).toBe(academicIsolationAllowlist);
    expect(sql).toMatch(/CREATE POLICY national_holidays_read ON academic\.national_holidays FOR SELECT USING \(true\)/);
    expect(sql).toMatch(/national_holidays_system_insert[^;]+current_actor\(\) = 'system'/);
    expect(sql).not.toMatch(/GRANT [A-Z, ]*DELETE[A-Z, ]* ON academic\.national_holidays/);
  });
  it("aucune clé étrangère vers un autre schéma que kernel.tenants", () => {
    const refs = [...sql.matchAll(/REFERENCES\s+([a-z_]+)\.(\w+)/g)].map((m) => `${m[1]}.${m[2]}`);
    for (const r of refs) expect(["academic.", "kernel.tenants"].some((p) => r.startsWith(p) || r === p), r).toBe(true);
    expect(refs.filter((r) => r.startsWith("kernel.")).every((r) => r === "kernel.tenants")).toBe(true);
  });
  it("tout code `academic.*` levé par un déclencheur SQL existe dans AcademicCode (contrat d'API stable)", () => {
    const raised = new Set([...sql.matchAll(/'(academic\.[a-z_]+):/g)].map((m) => m[1]));
    const known = new Set<string>(Object.values(AcademicCode));
    expect([...raised].filter((c) => !known.has(c as string))).toEqual([]);
    expect(raised.size).toBeGreaterThan(30);
  });
});

describe("garde-fous de la spec (lint, §12 / AC1.6)", () => {
  const code = new Map(sources.map((p) => [relative(moduleDir, p), stripComments(text(p))]));
  const asData = (p: string): boolean => p.startsWith("templates") || p.endsWith(".json");

  it("aucun littéral de période ou de pivot de date dans le code (09-01, septembre, semestre, trimestre)", () => {
    const offenders: string[] = [];
    for (const [file, src] of code) {
      if (asData(file)) continue;
      // Seuls les littéraux de chaîne comptent ; les messages destinés à l'utilisateur sont écartés ci-dessous.
      for (const m of src.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
        const lit = m[2] ?? "";
        if (/\b09-01\b|\bseptembre\b|\bsemestre\b|\btrimestre\b/i.test(lit) && !/\s/.test(lit)) offenders.push(`${file}: ${lit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("jamais de `new Date()` sans argument ni `Date.now()` : l'horloge est injectée", () => {
    const offenders = [...code].filter(([, src]) => /new Date\(\s*\)|Date\.now\(/.test(src)).map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it("aucun SQL hors de infrastructure/ (le domaine, l'application et le HTTP n'exécutent aucune requête)", () => {
    const offenders = [...code]
      .filter(([f]) => /^(domain|application|http)[\\/]/.test(f) || f === "subscribers.ts" || f === "jobs.ts")
      .filter(([, src]) => /\btx\.(query|queryOne|many)\(|\bpool\.query\(|\bclient\.query\(/.test(src))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it("aucune constante réglementaire ni seuil académique dans le code (20 crédits, 48 crédits, moyenne 10…)", () => {
    const offenders = [...code]
      .filter(([f]) => !asData(f) && f !== "manifest.ts")
      .filter(([, src]) => /SEMESTRE_CREDITS|ANNEE_SUP|PASS_MARK|seuil|moyenne\s*[>=<]/i.test(src))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it("aucun accès direct aux variables d'environnement ni console.* dans le module", () => {
    const offenders = [...code].filter(([, src]) => /process\.env|console\./.test(src)).map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it("la reconduction, les inscriptions et la clôture ne font aucune hypothèse de nom : pas de regex sur les libellés", () => {
    const offenders = [...code]
      .filter(([f]) => f.startsWith("domain") || f.startsWith("application"))
      .filter(([, src]) => /licence\\s|\/conduite|ILIKE\s+'conduite|BTS\s*2|SEMESTRE\s*2/i.test(src))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });
});
