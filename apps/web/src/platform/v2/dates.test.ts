import { describe, expect, it } from "vitest";
import { addDays, isCivilDate, isoWeekday, minutesToTime, mondayOf, todayCivil, weekDays } from "./dates";

describe("calendrier d'affichage", () => {
  it("jour ISO et lundi de la semaine (dimanche = 7, appartient à la semaine qui finit)", () => {
    expect(isoWeekday("2026-10-01")).toBe(4); // jeudi
    expect(isoWeekday("2026-10-04")).toBe(7); // dimanche
    expect(mondayOf("2026-10-01")).toBe("2026-09-28");
    expect(mondayOf("2026-10-04")).toBe("2026-09-28");
    expect(mondayOf("2026-09-28")).toBe("2026-09-28");
  });

  it("semaine de 7 jours, passage de mois et d'année", () => {
    expect(weekDays("2026-10-01")).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("aujourd'hui dans le fuseau de l'établissement (pas celui de l'appareil)", () => {
    // 23:30 UTC : déjà le lendemain à Auckland, encore le même jour à Abidjan (UTC+0).
    const instant = new Date("2026-10-01T23:30:00.000Z");
    expect(todayCivil(instant, "Africa/Abidjan")).toBe("2026-10-01");
    expect(todayCivil(instant, "Pacific/Auckland")).toBe("2026-10-02");
  });

  it("dates civiles inexistantes refusées ; minutes -> HH:MM", () => {
    expect(isCivilDate("2026-02-29")).toBe(false);
    expect(isCivilDate("2028-02-29")).toBe(true);
    expect(isCivilDate("2026-13-01")).toBe(false);
    expect(isCivilDate("1/10/2026")).toBe(false);
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(545)).toBe("09:05");
    expect(minutesToTime(1439)).toBe("23:59");
  });
});
