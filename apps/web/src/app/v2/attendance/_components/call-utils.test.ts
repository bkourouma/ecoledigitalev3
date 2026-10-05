import { describe, expect, it } from "vitest";
import type { AttendanceSessionDetailDto } from "@ecoledigitale/contracts/v2/attendance";
import { recordDto, sessionDetail, STUDENTS } from "../_test/fixtures";
import { buildRows, countByStatus, DEFAULT_STATUS, parseHalfDay, partQuery, pendingEntries, sessionOpenBody, statusTone, targetOf } from "./call-utils";

const detail = (records: Record<string, ReturnType<typeof recordDto>> = {}) => sessionDetail({ records }) as unknown as AttendanceSessionDetailDto;

describe("lignes d'appel : état serveur + saisies locales", () => {
  it("sans pointage ni saisie : tout le monde est présent par défaut (valeur affichée, pas une saisie)", () => {
    const rows = buildRows(detail(), {});
    expect(rows.map((r) => r.shown)).toEqual([DEFAULT_STATUS, DEFAULT_STATUS, DEFAULT_STATUS]);
    expect(rows.every((r) => r.isDefault && !r.pending)).toBe(true);
    expect(pendingEntries(rows)).toEqual([]);
  });

  it("une saisie locale l'emporte sur le serveur ; n'est « en attente » que si elle diffère", () => {
    const [a, b, c] = STUDENTS;
    const rows = buildRows(detail({ [a!.id]: recordDto(a!.id, "ABSENT") }), {
      [a!.id]: { statusCode: "ABSENT" }, // identique au serveur : rien à envoyer
      [b!.id]: { statusCode: "LATE", minutesLate: 10 },
      [c!.id]: { statusCode: "ABSENT" },
    });
    expect(rows.map((r) => [r.shown, r.pending, r.isDefault])).toEqual([
      ["ABSENT", false, false],
      ["LATE", true, false],
      ["ABSENT", true, false],
    ]);
    expect(pendingEntries(rows)).toEqual([
      { studentId: b!.id, statusCode: "LATE", minutesLate: 10 },
      { studentId: c!.id, statusCode: "ABSENT" },
    ]);
    expect(countByStatus(rows)).toEqual({ ABSENT: 2, LATE: 1 });
  });

  it("revenir à « présent » après un pointage serveur d'absence est bien une saisie à envoyer", () => {
    const a = STUDENTS[0]!;
    const rows = buildRows(detail({ [a.id]: recordDto(a.id, "ABSENT") }), { [a.id]: { statusCode: "PRESENT" } });
    expect(rows[0]).toMatchObject({ shown: "PRESENT", pending: true });
    expect(pendingEntries(rows)).toEqual([{ studentId: a.id, statusCode: "PRESENT" }]);
  });

  it("cibles : séance ou appel journalier, et corps d'ouverture correspondant", () => {
    expect(sessionOpenBody(targetOf("occurrence", "occ-1", "2026-10-01"))).toEqual({ occurrenceId: "occ-1" });
    expect(sessionOpenBody(targetOf("daily", "cls-1", "2026-10-01"))).toEqual({ scope: "DAILY", classroomId: "cls-1", date: "2026-10-01" });
    // Primaire, deux appels par jour (Q-P17) : la demi-journée est portée par la cible et par le corps d'ouverture.
    expect(sessionOpenBody(targetOf("daily", "cls-1", "2026-10-01", "MORNING"))).toEqual({ scope: "DAILY", classroomId: "cls-1", date: "2026-10-01", dayPart: "MORNING" });
    expect(sessionOpenBody(targetOf("daily", "cls-1", "2026-10-01", "AFTERNOON"))).toEqual({ scope: "DAILY", classroomId: "cls-1", date: "2026-10-01", dayPart: "AFTERNOON" });
    // Une séance planifiée n'a jamais de demi-journée.
    expect(sessionOpenBody(targetOf("occurrence", "occ-1", "2026-10-01", "MORNING"))).toEqual({ occurrenceId: "occ-1" });
  });

  it("teintes : le sens est porté par le texte, la couleur n'est qu'un renfort", () => {
    expect(statusTone("PRESENT")).toBe("success");
    expect(statusTone("ABSENT")).toBe("danger");
    expect(statusTone("LATE")).toBe("warning");
    expect(statusTone("EXCUSED")).toBe("info");
    expect(statusTone("CUSTOM")).toBe("neutral");
  });
});

describe("adresse d'un appel par demi-journée", () => {
  it("seules MORNING et AFTERNOON sont reconnues dans ?part= ; le reste est l'appel unique", () => {
    expect(parseHalfDay("MORNING")).toBe("MORNING");
    expect(parseHalfDay("AFTERNOON")).toBe("AFTERNOON");
    for (const bad of ["FULL", "morning", "", null, undefined, "<script>"]) expect(parseHalfDay(bad)).toBeUndefined();
    expect(partQuery("MORNING")).toBe("&part=MORNING");
    expect(partQuery(undefined)).toBe("");
  });
});
