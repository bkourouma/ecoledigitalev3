/**
 * Appel du primaire le MATIN et l'APRÈS-MIDI (décision Q-P17, 2026-10-05) : politique du cycle, minutes d'une demi-journée,
 * non-régression de l'appel journalier unique. Fonctions pures, aucune base.
 */
import { describe, expect, it } from "vitest";
import { dailyMinutesFor, HALF_DAY_PARTS, resolveDayPart } from "../../domain/session";
import type { CallPolicy } from "../../domain/types";
import { prepareMark, type MarkContext } from "../../domain/records";
import { indexStatuses } from "../../domain/status";
import { DEFAULT_ATTENDANCE_PACK } from "../../domain/reference-pack";
import { AttendanceEvents } from "../../domain/events";

const policy = (dailyCallMode: CallPolicy["dailyCallMode"]): Pick<CallPolicy, "dailyCallMode"> => ({ dailyCallMode });
const codeOf = (r: ReturnType<typeof resolveDayPart>): string | undefined => (r.ok ? undefined : (r.error as { code?: string }).code);

describe("demi-journée d'un appel journalier selon la politique du cycle", () => {
  it("appel journalier UNIQUE (SINGLE, ou aucune politique) : FULL par défaut ; le matin / l'après-midi est refusé (non-régression)", () => {
    for (const p of [policy("SINGLE"), null]) {
      expect(resolveDayPart(p, undefined)).toEqual({ ok: true, value: "FULL" });
      expect(resolveDayPart(p, "FULL")).toEqual({ ok: true, value: "FULL" });
      expect(codeOf(resolveDayPart(p, "MORNING"))).toBe("attendance.day_part_not_allowed");
      expect(codeOf(resolveDayPart(p, "AFTERNOON"))).toBe("attendance.day_part_not_allowed");
    }
  });

  it("deux appels par jour (HALF_DAYS) : la demi-journée est OBLIGATOIRE, jamais devinée ; la journée entière est refusée", () => {
    const p = policy("HALF_DAYS");
    expect(resolveDayPart(p, "MORNING")).toEqual({ ok: true, value: "MORNING" });
    expect(resolveDayPart(p, "AFTERNOON")).toEqual({ ok: true, value: "AFTERNOON" });
    expect(codeOf(resolveDayPart(p, undefined))).toBe("attendance.day_part_required");
    expect(codeOf(resolveDayPart(p, "FULL"))).toBe("attendance.day_part_not_allowed");
    expect(HALF_DAY_PARTS).toEqual(["MORNING", "AFTERNOON"]);
  });

  it("l'erreur de demi-journée manquante liste les valeurs permises (le client sait quoi proposer)", () => {
    const r = resolveDayPart(policy("HALF_DAYS"), undefined);
    expect(!r.ok && (r.error as { details?: unknown }).details).toMatchObject({ allowed: ["MORNING", "AFTERNOON"] });
  });
});

describe("minutes comptées pour une absence à l'appel journalier", () => {
  it("aucune durée supposée sans `dailyMinutes` (primaire : on ne compte que des journées)", () => {
    for (const part of ["FULL", "MORNING", "AFTERNOON"] as const) expect(dailyMinutesFor(null, part)).toBeNull();
  });

  it("une demi-journée compte la moitié de la durée de la journée ; la journée entière, la durée entière", () => {
    expect(dailyMinutesFor(300, "FULL")).toBe(300);
    expect(dailyMinutesFor(300, "MORNING")).toBe(150);
    expect(dailyMinutesFor(300, "AFTERNOON")).toBe(150);
    expect(dailyMinutesFor(301, "MORNING")).toBe(151);
  });

  it("l'absence d'un appel d'une demi-journée utilise cette moitié", () => {
    const defs = indexStatuses(
      DEFAULT_ATTENDANCE_PACK.statusDefinitions.map((s) => ({
        subjectKind: s.subject, code: s.code, label: s.label, countsAsPresent: s.present ?? false, countsAsAbsence: s.absence ?? false, countsAsLate: s.late ?? false,
        isJustified: s.justified ?? false, requiresJustification: false, sortOrder: 0, isSystem: true, active: true,
      })),
      "STUDENT",
    );
    const ctx = (dayPartMinutes: number | null): MarkContext => ({ scope: "DAILY", durationMinutes: null, endsAt: null, dailyMinutes: dayPartMinutes, lateRequiresMinutes: false });
    const mark = (c: MarkContext) => prepareMark({ studentId: "11111111-1111-4111-8111-111111111111", statusCode: "ABSENT" }, defs, c);
    expect(mark(ctx(dailyMinutesFor(300, "MORNING")))).toMatchObject({ ok: true, value: { countedMinutes: 150 } });
    expect(mark(ctx(dailyMinutesFor(null, "MORNING")))).toMatchObject({ ok: true, value: { countedMinutes: null } });
  });
});

describe("événements", () => {
  it("le type d'événement d'ouverture est inchangé (la demi-journée est une donnée de la charge utile, pas un nouvel événement)", () => {
    expect(AttendanceEvents.SESSION_OPENED).toBe("attendance.session.opened");
  });
});
