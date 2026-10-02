import { describe, expect, it } from "vitest";
import { buildAttendanceDays, EMPTY_DAY_COUNTS } from "../../domain/days";
import { DEFAULT_ATTENDANCE_PACK, normalizeCallPolicies, validatePackTemplate } from "../../domain/reference-pack";
import { buildAttendanceTemplates, defaultAttendanceTemplates, getAttendancePackTemplate } from "../../templates";
import ciPrimary from "../../templates/CI/primary.json";

describe("modèle de pack PRIMARY (spec 005 §14.2 « 010 »)", () => {
  it("le fichier déclare la politique PRIMARY_DAILY : portée DAILY, PRESCHOOL + PRIMARY, dailyMinutes null", () => {
    expect(ciPrimary.callPolicies).toEqual([
      { code: "PRIMARY_DAILY", label: "Appel journalier", scope: "DAILY", educationLevels: ["PRESCHOOL", "PRIMARY"], dailyMinutes: null },
    ]);
  });

  it("le modèle chargé développe la politique par niveau, sans aucune durée supposée, et hérite du reste de la base", () => {
    const t = getAttendancePackTemplate("CI", "PRIMARY");
    expect(t.callPolicies).toEqual([
      { code: "PRIMARY_DAILY", label: "Appel journalier", educationLevel: "PRESCHOOL", callScope: "DAILY", dailyMinutes: null },
      { code: "PRIMARY_DAILY", label: "Appel journalier", educationLevel: "PRIMARY", callScope: "DAILY", dailyMinutes: null },
    ]);
    expect(t.statusDefinitions).toEqual(DEFAULT_ATTENDANCE_PACK.statusDefinitions);
    expect(t.justificationReasons).toEqual(DEFAULT_ATTENDANCE_PACK.justificationReasons);
    expect(t.settings.alertRules).toEqual([]); // aucun seuil
    expect(t.callPolicies.every((p) => p.dailyMinutes === null)).toBe(true);
  });

  it("un pack sans fichier (SECONDARY, HIGHER) ou un système inconnu reçoit la base ; les modèles se valident une fois", () => {
    expect(getAttendancePackTemplate("CI", "SECONDARY")).toBe(DEFAULT_ATTENDANCE_PACK);
    expect(getAttendancePackTemplate("CI", "HIGHER")).toBe(DEFAULT_ATTENDANCE_PACK);
    expect(getAttendancePackTemplate("XX", "PRIMARY")).toBe(DEFAULT_ATTENDANCE_PACK);
    expect(defaultAttendanceTemplates()).toBe(defaultAttendanceTemplates());
    expect(() => buildAttendanceTemplates([ciPrimary, ciPrimary])).toThrow(/double/);
    expect(() => buildAttendanceTemplates([{ section: "attendance" }])).toThrow(/obligatoires/);
  });

  it("le modèle normalisé repasse la validation (idempotent) et la forme historique reste acceptée", () => {
    const t = getAttendancePackTemplate("CI", "PRIMARY");
    const again = validatePackTemplate(JSON.parse(JSON.stringify(t)));
    expect(again.ok && again.value.callPolicies).toEqual(t.callPolicies);
    const legacy = normalizeCallPolicies([{ educationLevel: "*", callScope: "SESSION", editWindowMinutes: 120 }]);
    expect(legacy.ok && legacy.value).toEqual([{ educationLevel: "*", callScope: "SESSION", editWindowMinutes: 120 }]);
  });

  it("refuse une politique incohérente (portée inconnue, niveaux vides, durée invalide, niveau en double)", () => {
    const base = { code: "P", label: "x", scope: "DAILY", educationLevels: ["PRIMARY"] };
    for (const bad of [
      [{ ...base, scope: "WEEKLY" }],
      [{ ...base, educationLevels: [] }],
      [{ ...base, educationLevels: [""] }],
      [{ ...base, dailyMinutes: 0 }],
      [{ ...base, dailyMinutes: 1.5 }],
      [{ ...base, dailyMinutes: "300" }],
      [{ ...base, editWindowMinutes: -1 }],
      [base, { ...base, code: "Q" }],
      "pas une liste",
    ]) {
      expect(normalizeCallPolicies(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(normalizeCallPolicies(undefined)).toMatchObject({ ok: true, value: [] });
    expect(normalizeCallPolicies([{ ...base, dailyMinutes: 300 }])).toMatchObject({ ok: true });
  });
});

describe("absences en journées (domaine pur)", () => {
  const window = { from: "2025-09-01", to: "2025-12-20" };
  const E = "11111111-1111-4111-8111-111111111111";

  it("sans appel : zéros, jamais d'erreur ; entrées de la règle cas_absences", () => {
    const d = buildAttendanceDays(E, window, EMPTY_DAY_COUNTS);
    expect(d).toMatchObject({ openDays: 0, openDaysSource: "CALLED_DAYS", absentDays: 0, unexcusedAbsentDays: 0, ruleInputs: { absences_journees: 0, jours_ouverts: 0 } });
  });

  it("les absences totales comptent les justifiées ; `excludeExcused` ne garde que les non justifiées", () => {
    const counts = { calledDays: 20, presentDays: 15, absentDays: 5, excusedAbsentDays: 2, lateDays: 3 };
    expect(buildAttendanceDays(E, window, counts).ruleInputs).toEqual({ absences_journees: 5, jours_ouverts: 20 });
    expect(buildAttendanceDays(E, window, counts, { excludeExcused: true })).toMatchObject({ unexcusedAbsentDays: 3, ruleInputs: { absences_journees: 3, jours_ouverts: 20 } });
  });

  it("le calendrier de l'établissement (openDays) remplace les jours d'appel tenus", () => {
    const counts = { calledDays: 18, presentDays: 15, absentDays: 3, excusedAbsentDays: 0, lateDays: 0 };
    expect(buildAttendanceDays(E, window, counts, { openDays: 20 })).toMatchObject({ openDays: 20, openDaysSource: "CALLER", ruleInputs: { jours_ouverts: 20 } });
  });
});
