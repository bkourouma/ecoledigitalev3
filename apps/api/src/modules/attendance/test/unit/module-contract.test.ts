import { describe, expect, it } from "vitest";
import { PERMISSION_KEY_RE, resolveModuleOrder } from "@ecoledigitale/kernel";
import {
  attendanceAlertRuleSchema,
  attendanceEventPayloadSchemas,
  attendanceMarkRecordsBodySchema,
  attendanceOpenSessionBodySchema,
  attendanceSetOverrideBodySchema,
  attendanceSubmitJustificationBodySchema,
  attendanceSubmitSessionBodySchema,
  attendanceSyncBatchSchema,
  attendanceRequestLeaveBodySchema,
} from "@ecoledigitale/contracts/src/v2/attendance";
import * as contractsIndex from "@ecoledigitale/contracts/src/v2";
import { SYSTEM_ROLE_TEMPLATES, buildPermissionCatalog, resolveSystemRoles, rbacManifest } from "../../../rbac";
import manifest from "../../manifest";
import subscribers from "../../subscribers";
import jobs from "../../jobs";
import { PERMISSIONS as ATTENDANCE_PERMISSIONS } from "../../http/guards";
import { ConsumedEvents } from "../../domain/events";

describe("manifeste du module attendance", () => {
  it("clé, dépendances, packs et unicité (s'insère dans l'ordre topologique sans cycle)", () => {
    expect(manifest).toMatchObject({ key: "attendance", dependsOn: ["rbac"] });
    expect(manifest.packs).toEqual(["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"]);
    const order = resolveModuleOrder([rbacManifest, manifest]).map((m) => m.key);
    expect(order.indexOf("rbac")).toBeLessThan(order.indexOf("attendance"));
  });

  it("permissions : format `ressource.action`, uniques, toutes utilisées par la couche HTTP, sensibles aux bons endroits", () => {
    const keys = manifest.permissions.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(PERMISSION_KEY_RE);
    expect([...Object.values(ATTENDANCE_PERMISSIONS)].sort()).toEqual([...keys].sort());
    const sensitive = manifest.permissions.filter((p) => p.sensitive).map((p) => p.key).sort();
    expect(sensitive).toEqual(["attendance.leave.decide", "attendance.session.reopen", "attendance.summary.override"]);
  });

  it("événements publiés = schémas du contrat ; événements consommés = ceux des abonnés", () => {
    expect([...manifest.events.publishes].sort()).toEqual(Object.keys(attendanceEventPayloadSchemas).sort());
    expect([...manifest.events.consumes].sort()).toEqual(Object.values(ConsumedEvents).sort());
    const patterns = subscribers.map((s) => String(s.pattern)).sort();
    for (const consumed of manifest.events.consumes) expect(patterns, consumed).toContain(consumed);
    expect(jobs.map((j) => j.name)).toEqual(["attendance.recompute-summaries"]);
  });

  it("menus : permission et feature déclarées, features rattachées aux packs", () => {
    expect(manifest.features.map((f) => f.key).sort()).toEqual(["attendance.live-bridge", "attendance.offline", "attendance.staff"]);
    for (const m of manifest.menus) {
      expect(manifest.permissions.some((p) => p.key === m.permission)).toBe(true);
      if (m.feature) expect(manifest.features.some((f) => f.key === m.feature)).toBe(true);
    }
  });
});

describe("alignement avec les rôles système du module rbac", () => {
  const catalog = buildPermissionCatalog([manifest]);
  const roles = new Map(resolveSystemRoles(catalog).map((r) => [r.template.key, new Set(r.permissions)]));
  const can = (role: string, perm: string): boolean => roles.get(role)?.has(perm) === true;

  it("enseignant : appel de ses classes, pas de décision ni de pièce médicale", () => {
    expect(can("enseignant", "attendance.read")).toBe(true);
    expect(can("enseignant", "attendance.take")).toBe(true);
    for (const p of ["attendance.manage", "attendance.validate", "attendance.session.reopen", "attendance.justification.read", "attendance.justification.decide", "attendance.summary.override"]) {
      expect(can("enseignant", p), p).toBe(false);
    }
  });

  it("parent : ses enfants seulement, y compris le dépôt d'un justificatif ; élève : lui-même", () => {
    for (const p of ["attendance.child.read", "attendance.child.justify"]) expect(can("parent", p), p).toBe(true);
    for (const p of ["attendance.take", "attendance.read", "attendance.self.read", "attendance.justification.read"]) expect(can("parent", p), p).toBe(false);
    for (const p of ["attendance.self.read", "attendance.self.justify"]) expect(can("eleve", p), p).toBe(true);
    expect(can("eleve", "attendance.child.read")).toBe(false);
  });

  it("éducateur et direction des études : tout le module ; responsable pédagogique et secrétariat : lecture", () => {
    for (const k of manifest.permissions.map((p) => p.key)) {
      expect(can("educateur", k), k).toBe(true);
      expect(can("directeur_etudes", k), k).toBe(true);
    }
    expect(can("responsable_pedagogique", "attendance.read")).toBe(true);
    expect(can("responsable_pedagogique", "attendance.take")).toBe(false);
    expect(can("secretariat", "attendance.read")).toBe(true);
    expect(can("secretariat", "attendance.justification.decide")).toBe(false);
    expect(SYSTEM_ROLE_TEMPLATES.length).toBeGreaterThan(5);
  });

  it("limite connue : aucun rôle système ne donne attendance.own.* au personnel (à ajouter au modèle de rôles de rbac)", () => {
    expect(can("enseignant", "attendance.own.read")).toBe(false);
    expect(can("enseignant", "attendance.own.record")).toBe(false);
    expect(can("enseignant", "attendance.leave.request")).toBe(false);
  });
});

describe("contrats Zod", () => {
  it("sont réexportés par l'index des contrats v2 sans collision de noms", () => {
    expect(contractsIndex.attendanceSyncBatchSchema).toBe(attendanceSyncBatchSchema);
    expect(Object.keys(contractsIndex).filter((k) => /^attendance/i.test(k)).length).toBeGreaterThan(60);
  });

  it("ouverture : une des trois formes, strictes", () => {
    const id = "01960000-0000-7000-8000-000000000001";
    expect(attendanceOpenSessionBodySchema.safeParse({ occurrenceId: id }).success).toBe(true);
    expect(attendanceOpenSessionBodySchema.safeParse({ scope: "DAILY", classroomId: id, date: "2025-10-01" }).success).toBe(true);
    expect(attendanceOpenSessionBodySchema.safeParse({ scope: "SESSION", classroomId: id, date: "2025-10-01", curriculumNodeId: id, source: "LIVE_CLASS" }).success).toBe(true);
    expect(attendanceOpenSessionBodySchema.safeParse({ scope: "SESSION", classroomId: id, date: "2025-10-01", curriculumNodeId: id, source: "MANUAL" }).success).toBe(false);
    expect(attendanceOpenSessionBodySchema.safeParse({ occurrenceId: id, classroomId: id }).success).toBe(false);
    expect(attendanceOpenSessionBodySchema.safeParse({ scope: "DAILY", classroomId: id, date: "2025-02-30" }).success).toBe(false);
  });

  it("lots de saisie et de synchronisation : bornes de volume et d'identité", () => {
    const id = "01960000-0000-7000-8000-000000000001";
    const entry = { studentId: id, statusCode: "ABSENT" };
    expect(attendanceMarkRecordsBodySchema.safeParse({ entries: [entry] }).success).toBe(true);
    expect(attendanceMarkRecordsBodySchema.safeParse({ entries: [] }).success).toBe(false);
    expect(attendanceMarkRecordsBodySchema.safeParse({ entries: [{ ...entry, statusCode: "absent" }] }).success).toBe(false);
    expect(attendanceMarkRecordsBodySchema.safeParse({ entries: [{ ...entry, minutesLate: 0 }] }).success).toBe(false);
    const record = { clientId: id, studentId: id, statusCode: "ABSENT", clientMarkedAt: "2025-10-01T10:00:00Z" };
    const session = { clientId: id, target: { occurrenceId: id }, clientOpenedAt: "2025-10-01T10:00:00Z", records: [record] };
    const batch = { deviceId: "d", clientSentAt: "2025-10-01T10:00:00Z", sessions: [session] };
    expect(attendanceSyncBatchSchema.safeParse(batch).success).toBe(true);
    expect(attendanceSyncBatchSchema.safeParse({ ...batch, sessions: [] }).success).toBe(false);
    expect(attendanceSyncBatchSchema.safeParse({ ...batch, deviceId: "" }).success).toBe(false);
    expect(attendanceSyncBatchSchema.safeParse({ ...batch, clientSentAt: "hier" }).success).toBe(false);
    expect(attendanceSyncBatchSchema.safeParse({ ...batch, sessions: [{ ...session, records: [{ ...record, clientId: "x" }] }] }).success).toBe(false);
    const big = Array.from({ length: 500 }, () => record);
    expect(attendanceSyncBatchSchema.safeParse({ ...batch, sessions: [1, 2, 3, 4, 5].map(() => ({ ...session, records: big })) }).success).toBe(false); // 2 500 > 2 000
  });

  it("soumission, justificatif, surcharge, congé et règle d'alerte : cohérence des champs", () => {
    const id = "01960000-0000-7000-8000-000000000001";
    expect(attendanceSubmitSessionBodySchema.safeParse({ allPresent: true }).success).toBe(true);
    expect(attendanceSubmitSessionBodySchema.safeParse({ allPresent: true, defaultStatus: "ABSENT" }).success).toBe(false);
    expect(attendanceSubmitJustificationBodySchema.safeParse({ studentId: id, fromDate: "2025-10-02", toDate: "2025-10-01", reasonCode: "ILLNESS" }).success).toBe(false);
    expect(attendanceSetOverrideBodySchema.safeParse({ enrollmentId: id, periodId: id, absentMinutes: 10, excusedMinutes: 11, reason: "Reprise" }).success).toBe(false);
    expect(attendanceSetOverrideBodySchema.safeParse({ enrollmentId: id, periodId: id, absentMinutes: 10, excusedMinutes: 10, reason: "abc" }).success).toBe(false);
    expect(attendanceRequestLeaveBodySchema.safeParse({ leaveTypeCode: "ANNUAL", startsOn: "2025-10-02", endsOn: "2025-10-01" }).success).toBe(false);
    expect(attendanceAlertRuleSchema.parse({ code: "R1", metric: "LATE_COUNT", threshold: 3 })).toEqual({ code: "R1", metric: "LATE_COUNT", threshold: 3, active: true });
    expect(attendanceAlertRuleSchema.safeParse({ code: "R1", metric: "LATE_COUNT", threshold: 0 }).success).toBe(false);
  });
});
