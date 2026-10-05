import { describe, expect, it } from "vitest";
import { ManualClock, newId } from "@ecoledigitale/kernel";
import { ALERT_METRICS, evaluateAlerts, metricValue, parseAlertRules, type AlertRule, type AlertState } from "../../domain/alerts";
import { daysInclusive, isIsoDate, maxDate, minDate, overlapDays, within } from "../../domain/dates";
import { assertJustificationTransition, canTransitionJustification, excusedFields, revokedFields, validateWindow, windowCovers } from "../../domain/justification";
import { detectMimeType, extensionFor, sanitizeFileName } from "../../domain/magic-bytes";
import { DEFAULT_ATTENDANCE_PACK, validatePackTemplate } from "../../domain/reference-pack";
import { assertTransition, callScopeAllows, canTransitionSession, checkEditable, durationOf, requiresReopen, selectPolicy } from "../../domain/session";
import { approvedLeaveDaysWithin, assertLeaveTransition, resolveStaffStatus, validateLeaveWindow } from "../../domain/staff";
import { absenceRateBps, computeSummary, effectiveSummary, sameCounts, validateOverride, type SummaryRecordInput } from "../../domain/summary";
import { decideSyncRecord, effectiveClientTime, type ExistingMarkForSync } from "../../domain/sync";
import { indexStatuses } from "../../domain/status";
import { EMPTY_SUMMARY, type CallPolicy, type StatusDefinition, type SummaryCounts } from "../../domain/types";
import { AttendanceEvents, ALL_ATTENDANCE_EVENT_TYPES } from "../../domain/events";

const defs = indexStatuses(
  DEFAULT_ATTENDANCE_PACK.statusDefinitions.map(
    (s): StatusDefinition => ({
      subjectKind: s.subject, code: s.code, label: s.label, countsAsPresent: s.present ?? false, countsAsAbsence: s.absence ?? false, countsAsLate: s.late ?? false,
      isJustified: s.justified ?? false, requiresJustification: false, sortOrder: 0, isSystem: true, active: true,
    }),
  ),
  "STUDENT",
);

describe("machine d'états de la séance d'appel", () => {
  it("transitions légales, réouverture réservée à VALIDATED", () => {
    expect(canTransitionSession("OPEN", "SUBMITTED")).toBe(true);
    expect(canTransitionSession("SUBMITTED", "OPEN")).toBe(true);
    expect(canTransitionSession("SUBMITTED", "VALIDATED")).toBe(true);
    expect(canTransitionSession("VALIDATED", "SUBMITTED")).toBe(true);
    expect(canTransitionSession("OPEN", "VALIDATED")).toBe(false);
    expect(canTransitionSession("CANCELLED", "OPEN")).toBe(false);
    expect(requiresReopen("VALIDATED")).toBe(true);
    expect(requiresReopen("SUBMITTED")).toBe(false);
    expect(assertTransition("OPEN", "SUBMITTED")).toMatchObject({ ok: true });
    expect(assertTransition("OPEN", "VALIDATED")).toMatchObject({ ok: false, error: { code: "attendance.invalid_transition" } });
  });

  it("fenêtre de correction : nulle = jusqu'à la validation ; passé le délai seule la direction corrige", () => {
    const now = new Date("2025-10-01T10:00:00Z");
    const submitted = { status: "SUBMITTED" as const, submittedAt: new Date("2025-10-01T08:30:00Z") };
    expect(checkEditable({ status: "OPEN", submittedAt: null }, null, { now, canManage: false }).ok).toBe(true);
    expect(checkEditable(submitted, { editWindowMinutes: 120 }, { now, canManage: false }).ok).toBe(true);
    expect(checkEditable(submitted, { editWindowMinutes: 60 }, { now, canManage: false })).toMatchObject({ ok: false, error: { code: "attendance.edit_window_closed" } });
    expect(checkEditable(submitted, { editWindowMinutes: 60 }, { now, canManage: true }).ok).toBe(true);
    expect(checkEditable(submitted, { editWindowMinutes: null }, { now, canManage: false }).ok).toBe(true);
    expect(checkEditable(submitted, null, { now, canManage: false }).ok).toBe(true);
    expect(checkEditable({ status: "VALIDATED", submittedAt: null }, null, { now, canManage: true })).toMatchObject({ ok: false, error: { code: "attendance.session_locked" } });
    expect(checkEditable({ status: "CANCELLED", submittedAt: null }, null, { now, canManage: true }).ok).toBe(false);
  });

  it("politique d'appel : niveau, sinon défaut de l'établissement, sinon aucune ; portée autorisée", () => {
    const I = newId();
    const mk = (level: string, scope: CallPolicy["callScope"]): CallPolicy => ({ institutionId: I, educationLevelCode: level, callScope: scope, editWindowMinutes: null, lateRequiresMinutes: false, dailyMinutes: null, dailyCallMode: "SINGLE" });
    const policies = [mk("PRIMARY", "DAILY"), mk("*", "SESSION"), { ...mk("PRIMARY", "BOTH"), institutionId: newId() }];
    expect(selectPolicy(policies, I, "PRIMARY")?.callScope).toBe("DAILY");
    expect(selectPolicy(policies, I, "LYCEE")?.callScope).toBe("SESSION");
    expect(selectPolicy(policies, I, null)?.callScope).toBe("SESSION");
    expect(selectPolicy([], I, "PRIMARY")).toBeNull();
    expect(callScopeAllows("BOTH", "DAILY")).toBe(true);
    expect(callScopeAllows("SESSION", "DAILY")).toBe(false);
    expect(callScopeAllows("DAILY", "DAILY")).toBe(true);
  });

  it("durée d'une séance : fournie, sinon déduite des bornes", () => {
    expect(durationOf(null, null, 45)).toBe(45);
    expect(durationOf(new Date("2025-10-01T08:00:00Z"), new Date("2025-10-01T09:30:00Z"), null)).toBe(90);
    expect(durationOf(new Date("2025-10-01T09:00:00Z"), new Date("2025-10-01T08:00:00Z"), null)).toBeNull();
    expect(durationOf(null, null, null)).toBeNull();
  });
});

describe("justificatifs : fenêtre, transitions, effet sur les pointages", () => {
  const base = { fromDate: "2025-10-01", toDate: "2025-10-02", today: "2025-10-05", yearStart: "2025-09-01", yearEnd: "2026-06-30", allowFuture: false, kind: "GUARDIAN" as const };
  it("valide la fenêtre contre l'année de l'inscription et le jour courant", () => {
    expect(validateWindow(base).ok).toBe(true);
    expect(validateWindow({ ...base, toDate: "2025-09-30" })).toMatchObject({ ok: false, error: { code: "attendance.justification_window_invalid" } });
    expect(validateWindow({ ...base, fromDate: "2025-08-31" })).toMatchObject({ ok: false });
    expect(validateWindow({ ...base, toDate: "2026-07-01", today: "2026-08-01" })).toMatchObject({ ok: false });
    expect(validateWindow({ ...base, toDate: "2025-10-06" })).toMatchObject({ ok: false, error: { code: "attendance.justification_future_not_allowed" } });
    // Le futur n'est possible que pour le personnel habilité ET si la politique l'autorise.
    expect(validateWindow({ ...base, toDate: "2025-10-06", allowFuture: true, kind: "GUARDIAN" }).ok).toBe(false);
    expect(validateWindow({ ...base, toDate: "2025-10-06", allowFuture: true, kind: "STAFF" }).ok).toBe(true);
    expect(validateWindow({ ...base, yearStart: null, yearEnd: null }).ok).toBe(true);
    expect(windowCovers(base, "2025-10-02")).toBe(true);
    expect(windowCovers(base, "2025-10-03")).toBe(false);
  });

  it("transitions : PENDING -> ACCEPTED | REJECTED | WITHDRAWN ; ACCEPTED -> REVOKED ; le reste est terminal", () => {
    expect(canTransitionJustification("PENDING", "ACCEPTED")).toBe(true);
    expect(canTransitionJustification("ACCEPTED", "REVOKED")).toBe(true);
    expect(canTransitionJustification("ACCEPTED", "REJECTED")).toBe(false);
    expect(canTransitionJustification("REVOKED", "ACCEPTED")).toBe(false);
    expect(assertJustificationTransition("ACCEPTED", "ACCEPTED")).toMatchObject({ ok: false, error: { code: "attendance.justification_not_pending" } });
    expect(assertJustificationTransition("PENDING", "REVOKED")).toMatchObject({ ok: false, error: { code: "attendance.invalid_transition" } });
    expect(assertJustificationTransition("REJECTED", "REVOKED")).toMatchObject({ ok: false, error: { code: "attendance.justification_not_accepted" } });
  });

  it("l'acceptation et la révocation sont des inverses exacts", () => {
    const J = newId();
    const excused = excusedFields({ statusCode: "ABSENT" }, J);
    expect(excused).toEqual({ statusCode: "EXCUSED", originalStatusCode: "ABSENT", excused: true, justificationId: J });
    expect(revokedFields({ statusCode: excused.statusCode, originalStatusCode: excused.originalStatusCode })).toEqual({ statusCode: "ABSENT", originalStatusCode: null, excused: false, justificationId: null });
    const late = excusedFields({ statusCode: "LATE" }, J);
    expect(late).toEqual({ statusCode: "LATE", originalStatusCode: null, excused: true, justificationId: J });
    expect(revokedFields({ statusCode: "LATE", originalStatusCode: null })).toMatchObject({ statusCode: "LATE", excused: false });
    expect(revokedFields({ statusCode: "EXCUSED", originalStatusCode: null }).statusCode).toBe("ABSENT"); // défense : donnée héritée sans statut d'origine
  });
});

describe("récapitulatif : comptage brut par famille de statut, surcharge, taux", () => {
  const rec = (statusCode: string, extra: Partial<SummaryRecordInput> = {}): SummaryRecordInput => ({
    sessionStatus: "SUBMITTED", sessionDate: "2025-10-01", statusCode, excused: false, minutesLate: null, countedMinutes: null, ...extra,
  });
  const window = { from: "2025-09-01", to: "2025-12-20" };

  it("absent* = total (justifiées comprises), excused* = sous-ensemble ; le retard est une présence", () => {
    const s = computeSummary(
      [
        rec("PRESENT"),
        rec("ABSENT", { countedMinutes: 60 }),
        rec("EXCUSED", { countedMinutes: 60, excused: true }),
        rec("LATE", { minutesLate: 10, countedMinutes: 10 }),
        rec("LATE", { minutesLate: 5, countedMinutes: 5, excused: true }),
        rec("EARLY_LEAVE", { countedMinutes: 20 }),
      ],
      defs,
      window,
    );
    expect(s).toEqual<SummaryCounts>({
      sessionsTotal: 6, presentCount: 4, absentCount: 2, excusedCount: 1, lateCount: 2, excusedLateCount: 1, earlyLeaveCount: 1, unmarkedCount: 0,
      absentMinutes: 120, excusedMinutes: 60, lateMinutes: 15,
    });
    expect(s.presentCount + s.absentCount).toBe(s.sessionsTotal);
  });

  it("ne compte que les séances SUBMITTED / VALIDATED de la fenêtre ; un statut sans définition est ignoré", () => {
    const s = computeSummary(
      [rec("ABSENT", { sessionStatus: "OPEN" }), rec("ABSENT", { sessionStatus: "CANCELLED" }), rec("ABSENT", { sessionDate: "2026-01-01" }), rec("ABSENT", { sessionStatus: "VALIDATED" }), rec("???")],
      defs,
      window,
    );
    expect(s.absentCount).toBe(1);
    expect(s.sessionsTotal).toBe(1);
    expect(computeSummary([], defs, window)).toEqual(EMPTY_SUMMARY);
  });

  it("surcharge : remplace les minutes seulement ; motif >= 5, entiers >= 0, justifié <= absent", () => {
    const derived: SummaryCounts = { ...EMPTY_SUMMARY, absentCount: 2, absentMinutes: 100, excusedMinutes: 40 };
    expect(effectiveSummary(derived, null)).toBe(derived);
    expect(effectiveSummary(derived, { absentMinutes: 300, excusedMinutes: 60 })).toEqual({ ...derived, absentMinutes: 300, excusedMinutes: 60 });
    expect(effectiveSummary(null, null)).toBe(EMPTY_SUMMARY);
    expect(validateOverride({ absentMinutes: 10, excusedMinutes: 10, reason: "  Reprise  " })).toMatchObject({ ok: true, value: { reason: "Reprise" } });
    for (const bad of [
      { absentMinutes: 10, excusedMinutes: 5, reason: "abcd" },
      { absentMinutes: 10, excusedMinutes: 11, reason: "Reprise" },
      { absentMinutes: -1, excusedMinutes: 0, reason: "Reprise" },
      { absentMinutes: 10, excusedMinutes: -1, reason: "Reprise" },
      { absentMinutes: 1.5, excusedMinutes: 0, reason: "Reprise" },
    ]) {
      expect(validateOverride(bad)).toMatchObject({ ok: false, error: { code: "attendance.override_invalid" } });
    }
    expect(sameCounts(derived, { ...derived })).toBe(true);
    expect(sameCounts(derived, { ...derived, lateCount: 1 })).toBe(false);
  });

  it("taux d'absence en points de base, arrondi au plus proche", () => {
    expect(absenceRateBps(0, 0)).toBe(0);
    expect(absenceRateBps(4, 1)).toBe(2500);
    expect(absenceRateBps(3, 1)).toBe(3333);
    expect(absenceRateBps(3, 2)).toBe(6667);
    expect(absenceRateBps(10, 10)).toBe(10_000);
  });
});

describe("alertes configurables : forme des règles, mesure, franchissement", () => {
  const rule = (over: Partial<AlertRule> = {}): AlertRule => ({ code: "R1", metric: "ABSENT_COUNT", threshold: 3, active: true, ...over });
  const summary = (over: Partial<SummaryCounts> = {}): SummaryCounts => ({ ...EMPTY_SUMMARY, sessionsTotal: 10, ...over });

  it("valide les règles fournies par l'établissement (aucun seuil par défaut)", () => {
    expect(parseAlertRules(undefined)).toEqual({ ok: true, value: [] });
    expect(parseAlertRules(null)).toEqual({ ok: true, value: [] });
    expect(parseAlertRules([{ code: "R1", metric: "LATE_COUNT", threshold: 2 }])).toEqual({ ok: true, value: [{ code: "R1", metric: "LATE_COUNT", threshold: 2, active: true }] });
    for (const bad of ["x", [1], [{ code: "r", metric: "LATE_COUNT", threshold: 2 }], [{ code: "R", metric: "X", threshold: 2 }], [{ code: "R", metric: "LATE_COUNT", threshold: 0 }], [{ code: "R", metric: "LATE_COUNT", threshold: 1.5 }], [rule(), rule()]]) {
      expect(parseAlertRules(bad)).toMatchObject({ ok: false, error: { code: "attendance.alert_rule_invalid" } });
    }
    expect(ALERT_METRICS).toHaveLength(6);
  });

  it("mesure chaque indicateur sur le récapitulatif effectif", () => {
    const s = summary({ absentCount: 4, excusedCount: 1, lateCount: 3, absentMinutes: 240, excusedMinutes: 60 });
    expect(metricValue("ABSENT_COUNT", s)).toBe(4);
    expect(metricValue("UNEXCUSED_ABSENT_COUNT", s)).toBe(3);
    expect(metricValue("LATE_COUNT", s)).toBe(3);
    expect(metricValue("ABSENT_MINUTES", s)).toBe(240);
    expect(metricValue("UNEXCUSED_ABSENT_MINUTES", s)).toBe(180);
    expect(metricValue("ABSENCE_RATE_BPS", s)).toBe(4000);
    expect(metricValue("UNEXCUSED_ABSENT_COUNT", summary({ absentCount: 0, excusedCount: 2 }))).toBe(0);
  });

  it("n'émet qu'au franchissement, lève à la baisse, ignore les règles inactives et nettoie les règles retirées", () => {
    const prev = (over: Partial<AlertState> = {}): AlertState => ({ ruleCode: "R1", metric: "ABSENT_COUNT", threshold: 3, lastValue: 3, active: true, ...over });
    expect(evaluateAlerts([rule()], summary({ absentCount: 2 }), [])).toEqual([]);
    expect(evaluateAlerts([rule()], summary({ absentCount: 3 }), [])).toEqual([{ kind: "TRIGGER", ruleCode: "R1", metric: "ABSENT_COUNT", threshold: 3, value: 3 }]);
    expect(evaluateAlerts([rule()], summary({ absentCount: 3 }), [prev()])).toEqual([]); // déjà franchie : silence
    expect(evaluateAlerts([rule()], summary({ absentCount: 5 }), [prev()])).toEqual([{ kind: "UPDATE", ruleCode: "R1", metric: "ABSENT_COUNT", threshold: 3, value: 5 }]);
    expect(evaluateAlerts([rule()], summary({ absentCount: 1 }), [prev()])).toEqual([{ kind: "CLEAR", ruleCode: "R1", metric: "ABSENT_COUNT", threshold: 3, value: 1 }]);
    expect(evaluateAlerts([rule()], summary({ absentCount: 4 }), [prev({ active: false })])[0]).toMatchObject({ kind: "TRIGGER" }); // re-franchissement après levée
    expect(evaluateAlerts([rule({ active: false })], summary({ absentCount: 9 }), [])).toEqual([]);
    expect(evaluateAlerts([], summary(), [prev()])).toEqual([{ kind: "CLEAR", ruleCode: "R1", metric: "ABSENT_COUNT", threshold: 3, value: 3 }]);
    expect(evaluateAlerts([], summary(), [prev({ active: false })])).toEqual([]);
  });
});

describe("synchronisation hors-ligne : horodatage et conflits", () => {
  const rc = new Date("2025-10-01T12:00:00Z");
  it("instant effectif = horloge appareil corrigée de sa dérive, plafonnée à la réception", () => {
    expect(effectiveClientTime(new Date("2025-10-01T11:00:00Z"), 0, rc).toISOString()).toBe("2025-10-01T11:00:00.000Z");
    expect(effectiveClientTime(new Date("2025-10-01T13:30:00Z"), 0, rc).toISOString()).toBe("2025-10-01T12:00:00.000Z");
    expect(effectiveClientTime(new Date("2025-10-01T13:30:00Z"), -2 * 3_600_000, rc).toISOString()).toBe("2025-10-01T11:30:00.000Z");
  });

  const A = newId();
  const B = newId();
  const incoming = { studentId: newId(), statusCode: "ABSENT", minutesLate: null, countedMinutes: 60, arrivedAt: null, leftAt: null, note: null };
  const existing = (over: Partial<ExistingMarkForSync> = {}): ExistingMarkForSync => ({
    statusCode: "PRESENT", originalStatusCode: null, minutesLate: null, countedMinutes: null, arrivedAt: null, leftAt: null, note: null, excused: false,
    markedBy: A, markedAt: new Date("2025-10-01T10:00:00Z"), clientMarkedAt: null, sourceDetail: "TEACHER", ...over,
  });
  const decide = (e: ExistingMarkForSync | null, at: string, actorId = B) => decideSyncRecord({ existing: e, incoming, incomingAt: new Date(at), actorId });

  it("décision par pointage", () => {
    expect(decide(null, "2025-10-01T09:00:00Z")).toEqual({ kind: "APPLY", reason: "NEW" });
    expect(decide(existing({ statusCode: "ABSENT", countedMinutes: 60 }), "2025-10-01T09:00:00Z")).toEqual({ kind: "UNCHANGED", reason: "SAME_CONTENT" });
    expect(decide(existing(), "2025-10-01T11:00:00Z")).toEqual({ kind: "APPLY", reason: "NEWER" });
    expect(decide(existing(), "2025-10-01T09:00:00Z")).toEqual({ kind: "CONFLICT", conflictKind: "STALE" });
    expect(decide(existing(), "2025-10-01T10:00:00Z")).toEqual({ kind: "CONFLICT", conflictKind: "STALE" }); // simultané : arbitrage humain
    expect(decide(existing(), "2025-10-01T09:00:00Z", A)).toEqual({ kind: "UNCHANGED", reason: "OLDER_SAME_AUTHOR" });
    // L'horodatage appareil du pointage en base prime sur l'instant de réception.
    expect(decide(existing({ clientMarkedAt: new Date("2025-10-01T08:00:00Z") }), "2025-10-01T09:00:00Z")).toEqual({ kind: "APPLY", reason: "NEWER" });
    // Un pointage externe n'est jamais prioritaire sur une saisie humaine, même plus ancienne.
    expect(decide(existing({ sourceDetail: "LIVE_CLASS" }), "2025-10-01T05:00:00Z")).toEqual({ kind: "APPLY", reason: "OVERRIDES_EXTERNAL" });
  });
});

describe("pièces jointes : type réel par octets magiques", () => {
  it("reconnaît PDF, JPEG, PNG, WebP et rien d'autre", () => {
    expect(detectMimeType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe("application/pdf");
    expect(detectMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(detectMimeType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(detectMimeType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull(); // RIFF/WAVE
    expect(detectMimeType(new Uint8Array([0x4d, 0x5a, 0x90]))).toBeNull(); // exécutable
    expect(detectMimeType(new Uint8Array([0x25, 0x50]))).toBeNull(); // trop court
    expect(detectMimeType(new Uint8Array())).toBeNull();
    expect(extensionFor("application/pdf")).toBe("pdf");
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("image/webp")).toBe("webp");
  });

  it("assainit le nom de fichier d'affichage", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\moi\\certificat.pdf")).toBe("certificat.pdf");
    expect(sanitizeFileName("a\u0000b\u001f.pdf")).toBe("ab.pdf");
    expect(sanitizeFileName("   ")).toBe("justificatif");
    expect(sanitizeFileName("x".repeat(400))).toHaveLength(255);
  });
});

describe("personnel : congés et statut du jour", () => {
  it("transitions de congé et fenêtre", () => {
    expect(assertLeaveTransition("REQUESTED", "APPROVED").ok).toBe(true);
    expect(assertLeaveTransition("APPROVED", "CANCELLED").ok).toBe(true);
    expect(assertLeaveTransition("APPROVED", "REJECTED")).toMatchObject({ ok: false, error: { code: "attendance.invalid_transition" } });
    expect(assertLeaveTransition("REJECTED", "APPROVED").ok).toBe(false);
    expect(validateLeaveWindow({ startsOn: "2025-10-02", endsOn: "2025-10-01" }).ok).toBe(false);
    expect(validateLeaveWindow({ startsOn: "2025-10-01", endsOn: "2025-10-01" }).ok).toBe(true);
  });

  it("ON_LEAVE exige un congé approuvé ; un congé approuvé impose ON_LEAVE sauf correction explicite", () => {
    const leave = { id: newId(), startsOn: "2025-10-01", endsOn: "2025-10-05" };
    expect(resolveStaffStatus({ requested: "ON_LEAVE", workDate: "2025-10-02", approvedLeave: leave, overrideLeave: false })).toEqual({ ok: true, value: { statusCode: "ON_LEAVE", leaveId: leave.id } });
    expect(resolveStaffStatus({ requested: "ON_LEAVE", workDate: "2025-10-02", approvedLeave: null, overrideLeave: false })).toMatchObject({ ok: false, error: { code: "attendance.on_leave_requires_leave" } });
    expect(resolveStaffStatus({ requested: "PRESENT", workDate: "2025-10-02", approvedLeave: leave, overrideLeave: false })).toMatchObject({ ok: false, error: { code: "attendance.staff_on_approved_leave" } });
    expect(resolveStaffStatus({ requested: "PRESENT", workDate: "2025-10-02", approvedLeave: leave, overrideLeave: true })).toEqual({ ok: true, value: { statusCode: "PRESENT", leaveId: null } });
    expect(resolveStaffStatus({ requested: "ABSENT", workDate: "2025-10-09", approvedLeave: null, overrideLeave: false }).ok).toBe(true);
    expect(approvedLeaveDaysWithin([leave, { startsOn: "2025-10-04", endsOn: "2025-10-20" }], "2025-10-03", "2025-10-06")).toBe(3 + 3);
  });
});

describe("dates calendaires", () => {
  it("valide, compare et mesure", () => {
    expect(isIsoDate("2025-02-29")).toBe(false);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-1-1")).toBe(false);
    expect(isIsoDate(20250101)).toBe(false);
    expect(daysInclusive("2025-10-01", "2025-10-01")).toBe(1);
    expect(daysInclusive("2025-10-01", "2025-10-31")).toBe(31);
    expect(overlapDays("2025-10-01", "2025-10-10", "2025-10-08", "2025-10-20")).toBe(3);
    expect(overlapDays("2025-10-01", "2025-10-05", "2025-10-08", "2025-10-20")).toBe(0);
    expect(maxDate("2025-10-01", "2025-10-02")).toBe("2025-10-02");
    expect(minDate("2025-10-01", "2025-10-02")).toBe("2025-10-01");
    expect(within("2025-10-02", "2025-10-01", "2025-10-03")).toBe(true);
    expect(within("2025-10-04", "2025-10-01", "2025-10-03")).toBe(false);
  });
});

describe("modèle de pack", () => {
  it("le modèle par défaut est valide et ne porte AUCUN seuil", () => {
    const checked = validatePackTemplate(JSON.parse(JSON.stringify(DEFAULT_ATTENDANCE_PACK)));
    expect(checked.ok).toBe(true);
    expect(DEFAULT_ATTENDANCE_PACK.settings.alertRules).toEqual([]);
    const sys = DEFAULT_ATTENDANCE_PACK.statusDefinitions;
    expect(sys.find((s) => s.subject === "STUDENT" && s.code === "LATE")).toMatchObject({ present: true, late: true });
    expect(sys.find((s) => s.subject === "STUDENT" && s.code === "EXCUSED")).toMatchObject({ absence: true, justified: true });
    expect(sys.find((s) => s.subject === "STUDENT" && s.code === "EARLY_LEAVE")).toMatchObject({ present: true });
  });

  it("refuse un modèle incohérent", () => {
    const ok = JSON.parse(JSON.stringify(DEFAULT_ATTENDANCE_PACK));
    for (const bad of [
      null,
      { ...ok, section: "autre" },
      { ...ok, schemaVersion: 2 },
      { ...ok, educationSystem: "" },
      { ...ok, statusDefinitions: [{ subject: "STUDENT", code: "bad", label: "x" }] },
      { ...ok, statusDefinitions: [{ subject: "STUDENT", code: "BOTH", label: "x", present: true, absence: true }] },
      { ...ok, statusDefinitions: [{ subject: "STUDENT", code: "JUST", label: "x", justified: true }] },
      { ...ok, justificationReasons: [{ code: "x", label: "x" }] },
      { ...ok, leaveTypes: [{ code: "OK", label: " " }] },
      { ...ok, settings: { alertRules: [{ code: "R", metric: "NOPE", threshold: 3 }] } },
    ]) {
      expect(validatePackTemplate(bad).ok).toBe(false);
    }
  });
});

describe("événements : noms et horloge", () => {
  it("noms `attendance.<entité>.<verbe-passé>` uniques", () => {
    expect(new Set(ALL_ATTENDANCE_EVENT_TYPES).size).toBe(ALL_ATTENDANCE_EVENT_TYPES.length);
    for (const t of ALL_ATTENDANCE_EVENT_TYPES) expect(t).toMatch(/^attendance\.[a-z_]+\.[a-z_]+$/);
    expect(AttendanceEvents.ABSENCE_RECORDED).toBe("attendance.absence.recorded");
    expect(new ManualClock("2025-10-01T00:00:00Z").now().toISOString()).toBe("2025-10-01T00:00:00.000Z");
  });
});
