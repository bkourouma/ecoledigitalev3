/**
 * Appel du matin et de l'après-midi (décision Q-P17) vu du pack Primary : registre mensuel par demi-journée et assiduité du bilan annuel
 * (demi-journées en chaînes décimales exactes dans l'instantané canonique). Fonctions pures.
 */
import { describe, expect, it } from "vitest";
import { primaryAttendanceSummarySchema } from "@ecoledigitale/contracts/src/v2/primary_school";
import { registerColumnLabel } from "../../application/reports";
import { attendanceText, canonicalJson, dayCount, reviewHash } from "../../domain/review";

describe("registre d'appel mensuel : une colonne par demi-journée", () => {
  it("l'appel de la journée entière garde le jour du mois ; matin et après-midi ont chacun leur colonne", () => {
    expect(registerColumnLabel("2026-10-05")).toBe("05");
    expect(registerColumnLabel("2026-10-05:MORNING")).toBe("05 matin");
    expect(registerColumnLabel("2026-10-05:AFTERNOON")).toBe("05 après-midi");
  });
});

describe("assiduité du bilan annuel", () => {
  it("entiers avec l'appel unique (bilans historiques inchangés), chaîne décimale exacte pour une demi-journée, null conservé", () => {
    expect(dayCount(120)).toBe(120);
    expect(dayCount(0)).toBe(0);
    expect(dayCount(2.5)).toBe("2.5");
    expect(dayCount(0.5)).toBe("0.5");
    expect(dayCount(null)).toBeNull();
  });

  it("l'instantané reste canonique : aucun flottant, empreinte stable", () => {
    const summary = { openDays: dayCount(119.5), absentDays: dayCount(3), justifiedAbsentDays: dayCount(1.5), lateCount: dayCount(0) };
    expect(canonicalJson(summary)).toBe('{"absentDays":3,"justifiedAbsentDays":"1.5","lateCount":0,"openDays":"119.5"}');
    const snapshot = {
      institutionId: "i", academicYearId: "y", enrollmentId: "e", studentId: "s", classroomId: "c", gradeLevelCode: "CM2", version: 1,
      yearResultRef: null, decisionRef: null, outcomeCode: null, competencySummary: {}, attendanceSummary: summary, ruleVersionRef: null,
    };
    expect(reviewHash(snapshot)).toBe(reviewHash({ ...snapshot }));
    expect(reviewHash({ ...snapshot, attendanceSummary: { ...summary, absentDays: dayCount(3.5) } })).not.toBe(reviewHash(snapshot));
  });

  it("le contrat accepte les entiers et les demi-journées (« N.5 »), refuse tout autre décimal ou une valeur négative", () => {
    const ok = (v: unknown) => primaryAttendanceSummarySchema.safeParse({ openDays: v }).success;
    expect(ok(120)).toBe(true);
    expect(ok("119.5")).toBe(true);
    expect(ok(null)).toBe(true);
    expect(ok(1.5)).toBe(false); // un flottant brut n'est jamais figé
    expect(ok("1.25")).toBe(false);
    expect(ok(-1)).toBe(false);
  });

  it("phrase d'assiduité du document : virgule française ; rien quand le récapitulatif est illisible", () => {
    expect(attendanceText({ openDays: "119.5", absentDays: "3.5", justifiedAbsentDays: 1, lateCount: 2 })).toBe(
      "3,5 journée(s) d'absence sur 119,5 journée(s) d'appel, dont 1 justifiée(s), 2 journée(s) de retard",
    );
    expect(attendanceText({ openDays: 100, absentDays: 4, justifiedAbsentDays: null, lateCount: null })).toBe("4 journée(s) d'absence sur 100 journée(s) d'appel");
    expect(attendanceText({ openDays: null, absentDays: null, justifiedAbsentDays: null, lateCount: null })).toBeNull();
  });
});
