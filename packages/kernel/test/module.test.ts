import { describe, expect, it } from "vitest";
import { defineModule, resolveModuleOrder } from "../src/module";

const base = { title: "T", packs: ["CORE"] as const };

describe("defineModule", () => {
  it("normalise et fige le manifeste", () => {
    const m = defineModule({ key: "audit", ...base, packs: ["CORE"] });
    expect(m.dependsOn).toEqual([]);
    expect(Object.isFrozen(m)).toBe(true);
  });
  it("refuse une clé, une permission ou un pack invalide", () => {
    expect(() => defineModule({ key: "Bad-Key", ...base, packs: ["CORE"] })).toThrow(/clé invalide/);
    expect(() => defineModule({ key: "a", title: "t", packs: [] })).toThrow(/au moins un pack/);
    expect(() =>
      defineModule({ key: "a", title: "t", packs: ["CORE"], permissions: [{ key: "Grade", label: "x" }] }),
    ).toThrow(/permission invalide/);
  });
  it("refuse un menu qui référence une permission non déclarée", () => {
    expect(() =>
      defineModule({
        key: "a",
        title: "t",
        packs: ["CORE"],
        menus: [{ key: "m", label: "M", href: "/m", permission: "a.read", portal: "admin" }],
      }),
    ).toThrow(/permission inconnue/);
  });
});

describe("resolveModuleOrder", () => {
  const mk = (key: string, dependsOn: string[] = [], perm?: string) =>
    defineModule({
      key,
      title: key,
      packs: ["CORE"],
      dependsOn,
      permissions: perm ? [{ key: perm, label: perm }] : [],
    });
  it("ordonne topologiquement", () => {
    const order = resolveModuleOrder([mk("c", ["b"]), mk("b", ["a"]), mk("a")]).map((m) => m.key);
    expect(order).toEqual(["a", "b", "c"]);
  });
  it("détecte cycle, dépendance inconnue et doublon de permission", () => {
    expect(() => resolveModuleOrder([mk("a", ["b"]), mk("b", ["a"])])).toThrow(/Cycle/);
    expect(() => resolveModuleOrder([mk("a", ["zz"])])).toThrow(/inconnue/);
    expect(() => resolveModuleOrder([mk("a", [], "x.read"), mk("b", [], "x.read")])).toThrow(/déclarée par/);
  });
});
