import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("BOM UTF-8, séparateur point-virgule, montants entiers bruts", () => {
    const csv = toCsv(["Élève", "Restant dû"], [["KONE Awa", 150000], ["TRAORE", 0]]);
    expect(csv.startsWith("﻿Élève;Restant dû\r\n")).toBe(true);
    expect(csv).toContain("KONE Awa;150000\r\n");
    expect(csv).toContain("TRAORE;0\r\n");
  });

  it("échappe guillemets, point-virgule et retours à la ligne", () => {
    const csv = toCsv(["a"], [['dit "oui"'], ["x;y"], ["l1\nl2"]]);
    expect(csv).toContain('"dit ""oui"""');
    expect(csv).toContain('"x;y"');
    expect(csv).toContain('"l1\nl2"');
  });

  it("neutralise l'injection de formules dans un tableur", () => {
    const csv = toCsv(["a"], [["=SOMME(A1)"], ["+1"], ["-2"], ["@cmd"]]);
    for (const dangerous of ["'=SOMME(A1)", "'+1", "'-2", "'@cmd"]) expect(csv).toContain(dangerous);
  });

  it("cellules vides pour null / undefined / non fini", () => {
    expect(toCsv(["a", "b", "c"], [[null, undefined, Number.NaN]])).toContain(";;\r\n");
  });
});
