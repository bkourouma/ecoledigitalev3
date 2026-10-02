import { describe, expect, it } from "vitest";
import { FINANCE_EXPORT_HEADERS, parseFinanceExportHeaders } from "@ecoledigitale/contracts/src/v2/finance";
import { csvCell, toCsv } from "../../domain/csv";
import { FAMILY_PERMISSIONS, familyIdempotencyKey } from "../../application/family";
import manifest from "../../manifest";

describe("CSV (pur)", () => {
  it("neutralise l'injection de formule sauf un nombre signé légitime", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+33612345678x")).toBe("'+33612345678x");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-12")).toBe("-12");
    expect(csvCell("-12,5")).toBe("-12,5");
    expect(csvCell("\tx")).toBe("'\tx");
  });
  it("échappe `;`, guillemets et sauts de ligne ; nul/indéfini = vide ; BOM + CRLF", () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell("l1\nl2")).toBe('"l1\nl2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(0)).toBe("0");
    expect(toCsv(["a", "b"], [[1, "x;y"]])).toBe('﻿a;b\r\n1;"x;y"\r\n');
    expect(toCsv(["a"], [])).toBe("﻿a\r\n");
  });
});

describe("en-têtes d'export lisibles par le client", () => {
  const h = (o: Record<string, string>) => (n: string) => o[n];
  it("lit une réponse complète et une réponse tronquée", () => {
    expect(parseFinanceExportHeaders(h({ [FINANCE_EXPORT_HEADERS.truncated]: "true", [FINANCE_EXPORT_HEADERS.rowCount]: "50000", [FINANCE_EXPORT_HEADERS.totalCount]: "61234", [FINANCE_EXPORT_HEADERS.maxRows]: "50000" }))).toEqual({ truncated: true, rowCount: 50000, totalCount: 61234, maxRows: 50000 });
    expect(parseFinanceExportHeaders(h({ [FINANCE_EXPORT_HEADERS.truncated]: "false", [FINANCE_EXPORT_HEADERS.rowCount]: "3", [FINANCE_EXPORT_HEADERS.totalCount]: "3", [FINANCE_EXPORT_HEADERS.maxRows]: "50000" }))?.truncated).toBe(false);
  });
  it("un en-tête manquant ou illisible n'est JAMAIS interprété comme « complet » (null)", () => {
    expect(parseFinanceExportHeaders(h({}))).toBeNull();
    expect(parseFinanceExportHeaders(h({ [FINANCE_EXPORT_HEADERS.truncated]: "peut-etre", [FINANCE_EXPORT_HEADERS.rowCount]: "1", [FINANCE_EXPORT_HEADERS.totalCount]: "1", [FINANCE_EXPORT_HEADERS.maxRows]: "1" }))).toBeNull();
    expect(parseFinanceExportHeaders(h({ [FINANCE_EXPORT_HEADERS.truncated]: "false", [FINANCE_EXPORT_HEADERS.rowCount]: "x", [FINANCE_EXPORT_HEADERS.totalCount]: "1", [FINANCE_EXPORT_HEADERS.maxRows]: "1" }))).toBeNull();
  });
});

describe("routes famille : clés d'idempotence et permissions déclarées", () => {
  it("la clé fournie est enfermée dans un espace de noms par utilisateur, déterministe et valide", () => {
    const a = familyIdempotencyKey("user-a", "ma-cle-123");
    expect(a).toBe(familyIdempotencyKey("user-a", " ma-cle-123 ")); // espaces ignorés comme validateIdempotencyKey
    expect(a).not.toBe(familyIdempotencyKey("user-b", "ma-cle-123"));
    expect(a).toMatch(/^fam:[0-9a-f]{48}$/);
    expect(a.length).toBeLessThanOrEqual(120);
  });
  it("les quatre permissions famille sont déclarées par le manifeste", () => {
    const declared = new Set(manifest.permissions.map((p) => p.key));
    for (const rel of Object.values(FAMILY_PERMISSIONS)) for (const key of Object.values(rel)) expect(declared.has(key), key).toBe(true);
    expect(declared.has("finance.child.read") && declared.has("finance.self.read")).toBe(true);
  });
  it("les entrées de menu famille exigent la permission correspondante", () => {
    const byKey = Object.fromEntries(manifest.menus.map((m) => [m.key, m.permission]));
    expect(byKey["finance.child"]).toBe("finance.child.read");
    expect(byKey["finance.self"]).toBe("finance.self.read");
  });
});
