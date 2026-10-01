import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./offline";

describe("safeReturnPath", () => {
  it("accepte uniquement les chemins internes", () => {
    expect(safeReturnPath("/owner/dashboard?vue=1")).toBe("/owner/dashboard?vue=1");
    expect(safeReturnPath("/")).toBe("/");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "owner", "", null, undefined, "/a\nb"])(
    "refuse %j (pas de redirection ouverte)",
    (value) => {
      expect(safeReturnPath(value as string)).toBe("/");
    },
  );

  it("ne renvoie pas vers /offline elle-même", () => {
    expect(safeReturnPath("/offline")).toBe("/");
    expect(safeReturnPath("/offline?from=%2Fx")).toBe("/");
  });

  it("borne la longueur", () => {
    expect(safeReturnPath("/" + "a".repeat(2000)).length).toBe(512);
  });
});
