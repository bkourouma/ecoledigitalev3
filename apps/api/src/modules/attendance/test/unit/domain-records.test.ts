import { describe, expect, it } from "vitest";
import { prepareMark, prepareMarks, sameMarkContent, withCoverage, enteredStatusOf, type MarkContext } from "../../domain/records";
import { indexStatuses, isExcusable, isSystemCode, resolveStatusUpsert } from "../../domain/status";
import { DEFAULT_ATTENDANCE_PACK } from "../../domain/reference-pack";
import type { StatusDefinition } from "../../domain/types";

const defs = indexStatuses(
  DEFAULT_ATTENDANCE_PACK.statusDefinitions.map(
    (s, i): StatusDefinition => ({
      subjectKind: s.subject,
      code: s.code,
      label: s.label,
      countsAsPresent: s.present ?? false,
      countsAsAbsence: s.absence ?? false,
      countsAsLate: s.late ?? false,
      isJustified: s.justified ?? false,
      requiresJustification: false,
      sortOrder: i,
      isSystem: s.system ?? false,
      active: true,
    }),
  ),
  "STUDENT",
);
const ctx: MarkContext = { scope: "SESSION", durationMinutes: 60, endsAt: new Date("2025-10-01T09:00:00Z"), dailyMinutes: null, lateRequiresMinutes: false };
const S = "00000000-0000-4000-8000-000000000001";

const code = (r: ReturnType<typeof prepareMark>): string | undefined => (r.ok ? undefined : r.error.code);

describe("préparation d'un pointage", () => {
  it("calcule les minutes comptées par famille de statut (R7)", () => {
    expect(prepareMark({ studentId: S, statusCode: "PRESENT" }, defs, ctx)).toMatchObject({ ok: true, value: { countedMinutes: null, minutesLate: null } });
    expect(prepareMark({ studentId: S, statusCode: "ABSENT" }, defs, ctx)).toMatchObject({ ok: true, value: { countedMinutes: 60 } });
    expect(prepareMark({ studentId: S, statusCode: "LATE", minutesLate: 12 }, defs, ctx)).toMatchObject({ ok: true, value: { countedMinutes: 12, minutesLate: 12 } });
    expect(prepareMark({ studentId: S, statusCode: "LATE" }, defs, ctx)).toMatchObject({ ok: true, value: { countedMinutes: null } });
    expect(prepareMark({ studentId: S, statusCode: "EARLY_LEAVE", minutesMissed: 25 }, defs, ctx)).toMatchObject({ ok: true, value: { countedMinutes: 25 } });
    // Départ anticipé déduit de l'heure de départ et de la fin de séance.
    expect(prepareMark({ studentId: S, statusCode: "EARLY_LEAVE", leftAt: new Date("2025-10-01T08:40:00Z") }, defs, ctx)).toMatchObject({ ok: true, value: { countedMinutes: 20 } });
    expect(prepareMark({ studentId: S, statusCode: "EARLY_LEAVE" }, defs, ctx)).toMatchObject({ ok: true, value: { countedMinutes: null } });
  });

  it("appel journalier : la durée vient de la politique (daily_minutes), jamais d'une constante ; sinon nulle", () => {
    const daily: MarkContext = { scope: "DAILY", durationMinutes: null, endsAt: null, dailyMinutes: 300, lateRequiresMinutes: false };
    expect(prepareMark({ studentId: S, statusCode: "ABSENT" }, defs, daily)).toMatchObject({ ok: true, value: { countedMinutes: 300 } });
    expect(prepareMark({ studentId: S, statusCode: "ABSENT" }, defs, { ...daily, dailyMinutes: null })).toMatchObject({ ok: true, value: { countedMinutes: null } });
  });

  it("refuse : statut inconnu ou désactivé, EXCUSED direct, minutes incohérentes, retard sans minutes si la politique l'exige", () => {
    expect(code(prepareMark({ studentId: S, statusCode: "NOPE" }, defs, ctx))).toBe("attendance.status_unknown");
    const inactive = indexStatuses([{ ...defs.get("ABSENT")!, active: false }], "STUDENT");
    expect(code(prepareMark({ studentId: S, statusCode: "ABSENT" }, inactive, ctx))).toBe("attendance.status_inactive");
    expect(code(prepareMark({ studentId: S, statusCode: "EXCUSED" }, defs, ctx))).toBe("attendance.excused_requires_justification");
    expect(code(prepareMark({ studentId: S, statusCode: "ABSENT", minutesLate: 3 }, defs, ctx))).toBe("attendance.minutes_invalid");
    expect(code(prepareMark({ studentId: S, statusCode: "LATE", minutesMissed: 3 }, defs, ctx))).toBe("attendance.minutes_invalid");
    expect(code(prepareMark({ studentId: S, statusCode: "LATE", minutesLate: 90 }, defs, ctx))).toBe("attendance.minutes_invalid"); // > durée de la séance
    expect(code(prepareMark({ studentId: S, statusCode: "LATE", minutesLate: 0 }, defs, ctx))).toBe("attendance.minutes_invalid");
    expect(code(prepareMark({ studentId: S, statusCode: "LATE" }, defs, { ...ctx, lateRequiresMinutes: true }))).toBe("attendance.minutes_late_required");
    expect(code(prepareMark({ studentId: S, statusCode: "EARLY_LEAVE", minutesMissed: 90 }, defs, ctx))).toBe("attendance.minutes_invalid");
    expect(code(prepareMark({ studentId: S, statusCode: "PRESENT", arrivedAt: new Date("2025-10-01T08:10:00Z"), leftAt: new Date("2025-10-01T08:00:00Z") }, defs, ctx))).toBe("attendance.minutes_invalid");
  });

  it("un lot refuse les doublons d'élève et s'arrête à la première erreur", () => {
    expect(prepareMarks([{ studentId: S, statusCode: "PRESENT" }, { studentId: S, statusCode: "ABSENT" }], defs, ctx)).toMatchObject({ ok: false, error: { code: "attendance.duplicate_entry" } });
    expect(prepareMarks([{ studentId: S, statusCode: "PRESENT" }, { studentId: "00000000-0000-4000-8000-000000000002", statusCode: "ZZ" }], defs, ctx)).toMatchObject({ ok: false });
    const ok = prepareMarks([{ studentId: S, statusCode: "PRESENT", note: "  ok  " }], defs, ctx);
    expect(ok).toMatchObject({ ok: true, value: [{ note: "ok" }] });
  });
});

describe("excuse couverte par un justificatif accepté", () => {
  const J = "00000000-0000-4000-8000-0000000000aa";
  const mark = (statusCode: string) => {
    const p = prepareMark({ studentId: S, statusCode, ...(statusCode === "LATE" ? { minutesLate: 5 } : {}) }, defs, ctx);
    if (!p.ok) throw p.error;
    return p.value;
  };

  it("ABSENT devient EXCUSED (statut d'origine conservé) ; retard et départ anticipé gardent leur statut avec excused", () => {
    expect(withCoverage(mark("ABSENT"), defs.get("ABSENT"), J)).toMatchObject({ statusCode: "EXCUSED", originalStatusCode: "ABSENT", excused: true, justificationId: J });
    expect(withCoverage(mark("LATE"), defs.get("LATE"), J)).toMatchObject({ statusCode: "LATE", originalStatusCode: null, excused: true, justificationId: J });
    expect(withCoverage(mark("EARLY_LEAVE"), defs.get("EARLY_LEAVE"), J)).toMatchObject({ statusCode: "EARLY_LEAVE", excused: true });
  });

  it("une présence, ou une absence sans justificatif, n'est pas excusée", () => {
    expect(withCoverage(mark("PRESENT"), defs.get("PRESENT"), J)).toMatchObject({ statusCode: "PRESENT", excused: false, justificationId: null });
    expect(withCoverage(mark("ABSENT"), defs.get("ABSENT"), null)).toMatchObject({ statusCode: "ABSENT", excused: false });
    expect(isExcusable(defs.get("EXCUSED"))).toBe(false);
    expect(isExcusable(undefined)).toBe(false);
  });

  it("compare le contenu saisi (rejeu) à l'état courant, excuse comprise", () => {
    const excused = { statusCode: "EXCUSED", originalStatusCode: "ABSENT", minutesLate: null, countedMinutes: 60, arrivedAt: null, leftAt: null, note: null };
    expect(enteredStatusOf(excused)).toBe("ABSENT");
    expect(sameMarkContent(excused, mark("ABSENT"))).toBe(true);
    expect(sameMarkContent(excused, mark("PRESENT"))).toBe(false);
    expect(sameMarkContent({ ...excused, note: "x" }, mark("ABSENT"))).toBe(false);
    expect(sameMarkContent({ ...excused, arrivedAt: new Date("2025-10-01T08:00:00Z") }, mark("ABSENT"))).toBe(false);
  });
});

describe("statuts : données, sémantique système verrouillée", () => {
  const absent = defs.get("ABSENT")!;
  it("un tenant AJOUTE des statuts, ne modifie pas la sémantique des statuts système et ne les désactive pas", () => {
    expect(isSystemCode("STUDENT", "ABSENT")).toBe(true);
    expect(isSystemCode("STAFF", "EXCUSED")).toBe(false);
    const added = resolveStatusUpsert(undefined, { subjectKind: "STUDENT", code: "MEDICAL_LEAVE", label: "Congé médical", countsAsAbsence: true });
    expect(added).toMatchObject({ ok: true, value: { isSystem: false, countsAsAbsence: true, active: true } });
    expect(resolveStatusUpsert(absent, { subjectKind: "STUDENT", code: "ABSENT", label: "Absent(e)", sortOrder: 5 })).toMatchObject({ ok: true, value: { label: "Absent(e)", sortOrder: 5, isSystem: true } });
    expect(resolveStatusUpsert(absent, { subjectKind: "STUDENT", code: "ABSENT", label: "Absent", countsAsPresent: true })).toMatchObject({ ok: false, error: { code: "attendance.system_status_immutable" } });
    expect(resolveStatusUpsert(absent, { subjectKind: "STUDENT", code: "ABSENT", label: "Absent", active: false })).toMatchObject({ ok: false, error: { code: "attendance.system_status_immutable" } });
    expect(resolveStatusUpsert(undefined, { subjectKind: "STUDENT", code: "LATE", label: "Autre sens", countsAsAbsence: true })).toMatchObject({ ok: false });
  });

  it("reproduit les CHECK de la table avant la base", () => {
    expect(resolveStatusUpsert(undefined, { subjectKind: "STUDENT", code: "x", label: "x" })).toMatchObject({ ok: false });
    expect(resolveStatusUpsert(undefined, { subjectKind: "STUDENT", code: "OK", label: "  " })).toMatchObject({ ok: false });
    expect(resolveStatusUpsert(undefined, { subjectKind: "STUDENT", code: "BOTH", label: "x", countsAsPresent: true, countsAsAbsence: true })).toMatchObject({ ok: false });
    expect(resolveStatusUpsert(undefined, { subjectKind: "STUDENT", code: "JUST", label: "x", isJustified: true })).toMatchObject({ ok: false });
  });
});
