import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../../../messages/fr-CI.json";
import {
  ACADEMIC_CLASSROOM_STATUSES,
  ACADEMIC_COURSE_SOURCES,
  ACADEMIC_COURSE_STATUSES,
  ACADEMIC_CONFIRMATION_POLICIES,
  ACADEMIC_ENROLLMENT_MODES,
  ACADEMIC_ENROLLMENT_STATUSES,
  ACADEMIC_FUNDING_CODES,
  ACADEMIC_HISTORY_KINDS,
  ACADEMIC_OFFERING_STATUSES,
  ACADEMIC_PERIOD_STATUSES,
  ACADEMIC_VERSION_STATUSES,
  ACADEMIC_YEAR_STATUSES,
} from "@ecoledigitale/contracts/v2/academic";

import { PEOPLE_ASSIGNMENT_ROLES, PEOPLE_STAFF_STATUSES, PEOPLE_STUDENT_STATUSES } from "@ecoledigitale/contracts/v2/people";

const FLAGS = ["isPrimaryContact", "isEmergencyContact", "isFinancialResponsible", "hasLegalCustody", "canPickup", "portalAccess"] as const;

/**
 * Filet de sécurité i18n : toute clé passée à `t("…")` dans les écrans v2 et les composants partagés doit exister dans
 * `messages/fr-CI.json`. Les clés calculées (`t(\`status.${x}\`)`) sont couvertes par les listes d'énumérations ci-dessous.
 */

const ROOT = path.resolve(__dirname, "../..");
// Périmètre de ce test : le cœur académique et les personnes (les autres sections du portail v2 ont leurs propres tests).
const SECTIONS = ["academic", "enrollments", "students", "student", "guardians", "staff"];
const SOURCES = [...SECTIONS.map((s) => path.join(ROOT, "app/v2", s)), path.join(ROOT, "platform/ui")];

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

describe("messages fr-CI", () => {
  it("toutes les clés statiques utilisées par les écrans v2 existent", () => {
    const missing: string[] = [];
    for (const file of SOURCES.flatMap(walk)) {
      const source = fs.readFileSync(file, "utf8");
      // Une même variable (`t`) peut être liée à deux espaces de noms dans un fichier : chaque déclaration vaut jusqu'à la suivante.
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
      ["v2Academic.status.year", ACADEMIC_YEAR_STATUSES],
      ["v2Academic.status.period", ACADEMIC_PERIOD_STATUSES],
      ["v2Academic.status.version", ACADEMIC_VERSION_STATUSES],
      ["v2Academic.status.classroom", ACADEMIC_CLASSROOM_STATUSES],
      ["v2Academic.status.offering", ACADEMIC_OFFERING_STATUSES],
      ["v2Academic.status.program", ["ACTIVE", "ARCHIVED"]],
      ["v2Enrollments.status", ACADEMIC_ENROLLMENT_STATUSES],
      ["v2Enrollments.wizard.doneStatus", ACADEMIC_ENROLLMENT_STATUSES],
      ["v2Enrollments.courseStatus", ACADEMIC_COURSE_STATUSES],
      ["v2Enrollments.funding", ACADEMIC_FUNDING_CODES],
      ["v2Enrollments.mode", ACADEMIC_ENROLLMENT_MODES],
      ["v2Enrollments.wizard.classroom.mode", ACADEMIC_ENROLLMENT_MODES],
      ["v2Enrollments.detail.history.kind", ACADEMIC_HISTORY_KINDS],
      ["v2Enrollments.detail.courses.source", ACADEMIC_COURSE_SOURCES],
      ["v2Enrollments.detail.confirmation.policies", ACADEMIC_CONFIRMATION_POLICIES],
      ["v2Enrollments.detail.actions", ["confirm", "resume", "reopen", "suspend", "complete", "withdraw", "cancel", "transfer"]],
      ["v2Enrollments.detail.done", ["confirm", "resume", "reopen", "suspend", "complete", "withdraw", "cancel", "transfer", "funding"]],
      ["v2Enrollments.detail.reasonTitle", ["confirm", "resume", "reopen", "suspend", "complete", "withdraw", "cancel"]],
      ["v2Enrollments.detail.reasonDescription", ["confirm", "resume", "reopen", "suspend", "complete", "withdraw", "cancel"]],
      ["v2Students.status", PEOPLE_STUDENT_STATUSES],
      ["v2Students.guardianForm.flag", FLAGS],
      ["v2Students.guardianForm.flagHint", FLAGS],
      ["v2Students.detail.guardians.flagShort", FLAGS],
      ["v2Students.detail.guardians.kind", ["existing", "new"]],
      ["v2Students.detail.schooling.prior.kind", ["SCHOOL", "DIPLOMA", "CERTIFICATE", "OTHER"]],
      ["v2Academic.classroomDetail.assignments.roles", PEOPLE_ASSIGNMENT_ROLES],
      ["v2Staff.status", PEOPLE_STAFF_STATUSES],
      ["v2Staff.contractStatus", ["DRAFT", "ACTIVE", "ENDED", "CANCELLED"]],
      ["v2Staff.roles", PEOPLE_ASSIGNMENT_ROLES],
      ["v2Staff.qualifications.kind", ["DIPLOMA", "CERTIFICATION", "AUTHORIZATION", "OTHER"]],
      ["v2Staff.availabilities.kind", ["AVAILABLE", "UNAVAILABLE"]],
      ["v2Staff.availabilities.weekday", ["1", "2", "3", "4", "5", "6", "7"]],
      ["v2Students.duplicates.match", ["EXACT", "NEAR", "NAME_ONLY", "EMAIL", "PHONE"]],
      ["v2Students.duplicates.role", ["STUDENT", "GUARDIAN", "STAFF"]],
    ];
    const missing: string[] = [];
    for (const [ns, values] of expectations) for (const v of values) if (typeof lookup(ns, v) !== "string") missing.push(`${ns}.${v}`);
    expect(missing).toEqual([]);
  });
});
