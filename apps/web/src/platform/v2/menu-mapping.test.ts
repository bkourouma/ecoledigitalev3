import { describe, expect, it } from "vitest";
import { mapToV2Href } from "@/platform/admin/menu";

describe("menus des manifestes `attendance` et `scheduling` -> routes /v2", () => {
  it("réécrit les entrées du portail admin vers les écrans v2 livrés", () => {
    expect(mapToV2Href("/admin/attendance")).toBe("/v2/attendance/sessions");
    expect(mapToV2Href("/admin/attendance/justificatifs")).toBe("/v2/attendance/justifications");
    expect(mapToV2Href("/admin/attendance/personnel")).toBe("/v2/attendance/staff");
    expect(mapToV2Href("/admin/emploi-du-temps")).toBe("/v2/schedule/timetables");
    expect(mapToV2Href("/admin/emploi-du-temps/salles")).toBe("/v2/schedule/rooms");
    expect(mapToV2Href("/admin/emploi-du-temps/remplacements")).toBe("/v2/schedule/replacements");
  });

  it("laisse intactes les entrées sans écran v2 (paramètres de présence, calendrier, validation des séances)", () => {
    for (const href of ["/admin/attendance/parametres", "/admin/emploi-du-temps/calendrier", "/admin/emploi-du-temps/validation"]) {
      expect(mapToV2Href(href)).toBe(href);
    }
  });
});
