import { describe, expect, it } from "vitest";
import type { AttendanceSessionDetailDto } from "@ecoledigitale/contracts/v2/attendance";
import { recordDto, sessionDetail, STUDENTS } from "../_test/fixtures";
import { buildRows, countByStatus, DEFAULT_STATUS, pendingEntries, sessionOpenBody, statusTone, targetOf } from "./call-utils";

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
  });

  it("teintes : le sens est porté par le texte, la couleur n'est qu'un renfort", () => {
    expect(statusTone("PRESENT")).toBe("success");
    expect(statusTone("ABSENT")).toBe("danger");
    expect(statusTone("LATE")).toBe("warning");
    expect(statusTone("EXCUSED")).toBe("info");
    expect(statusTone("CUSTOM")).toBe("neutral");
  });
});
