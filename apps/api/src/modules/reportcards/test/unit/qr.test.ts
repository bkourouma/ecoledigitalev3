import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { QrCapacityError, encodeQr, qrToSvg } from "../../domain/qr";

const hashOf = (m: { modules: ReadonlyArray<ReadonlyArray<boolean>> }): string =>
  createHash("sha256").update(m.modules.map((r) => r.map((c) => (c ? "1" : "0")).join("")).join("\n")).digest("hex");

/**
 * Vecteurs de référence : matrices identiques, module pour module, à celles d'une implémentation indépendante
 * (`qrcode` 1.5.4, mode octets, niveau M, masque forcé) — vérifié hors dépôt pour les 8 masques de 4 textes, puis figé ici.
 */
describe("encodeur QR (ISO 18004, niveau M, mode octets)", () => {
  const URL_TEXT = "https://verif.ecoledigitale.example/v/ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  it("version minimale choisie selon la capacité (octets, niveau M)", () => {
    expect(encodeQr("a").version).toBe(1);
    expect(encodeQr("x".repeat(14)).version).toBe(1);
    expect(encodeQr("x".repeat(15)).version).toBe(2);
    expect(encodeQr(URL_TEXT).version).toBe(5);
    expect(encodeQr("x".repeat(150)).version).toBe(8);
    expect(encodeQr("y".repeat(213)).version).toBe(10);
  });

  it("taille = 17 + 4 × version ; motifs de repérage aux trois coins ; synchronisation ; module sombre fixe", () => {
    const q = encodeQr(URL_TEXT);
    const n = q.size;
    expect(n).toBe(17 + 4 * q.version);
    const finder = (ox: number, oy: number): string => Array.from({ length: 7 }, (_, y) => Array.from({ length: 7 }, (_, x) => (q.modules[oy + y]![ox + x] ? "1" : "0")).join("")).join("/");
    const expected = "1111111/1000001/1011101/1011101/1011101/1000001/1111111";
    expect(finder(0, 0)).toBe(expected);
    expect(finder(n - 7, 0)).toBe(expected);
    expect(finder(0, n - 7)).toBe(expected);
    for (let i = 8; i < n - 8; i += 1) {
      expect(q.modules[6]![i]).toBe(i % 2 === 0);
      expect(q.modules[i]![6]).toBe(i % 2 === 0);
    }
    expect(q.modules[n - 8]![8]).toBe(true);
  });

  it("déterministe : même texte, même matrice", () => {
    expect(hashOf(encodeQr(URL_TEXT))).toBe(hashOf(encodeQr(URL_TEXT)));
    expect(hashOf(encodeQr(URL_TEXT))).not.toBe(hashOf(encodeQr(`${URL_TEXT}x`)));
  });

  it("matrices de référence figées (masques forcés)", () => {
    const cases: Array<[string, number, string]> = [
      ["a", 5, "e8ab680854e4019c4ac89bd0e19dfe1f7e967f3cafd048091b3e3ec474b6f431"],
      [URL_TEXT, 3, "6a801205e11fa1b0e04a93460b0d10e161528179be48650c6b60ecf6aec15ef2"],
      ["https://verification.exemple-ecole.org/v/ABCDEFGHIJKLMNOPQRSTUVWXYZ2345?lang=fr&utm=abcdefghijklmnopqrstuvwxyz0123456789", 2, "e12771d07cb8fe508a50adda74501ecde6aa5501f248b835f72e69e947eef4f3"],
      ["x".repeat(150), 2, "9782fa7f0642d3e6b22295c01fc9e2fe9a0f19d22af2cf7b3964dcb6a932e44e"], // 4 blocs inégaux (version 8)
      ["y".repeat(213), 1, "3bb4dc258df63cd72866923bcf69b2a163f017bd6dd5d9d77a92f7f81ad9c892"], // version 10, 5 blocs
    ];
    for (const [text, mask, expected] of cases) expect(hashOf(encodeQr(text, { mask }))).toBe(expected);
    // Sans masque imposé, le choix par pénalité est stable pour ces textes.
    expect(encodeQr(URL_TEXT).mask).toBe(3);
  });

  it("refuse un texte trop long (> 213 octets) avec une erreur explicite", () => {
    expect(() => encodeQr("z".repeat(214))).toThrow(QrCapacityError);
  });

  it("SVG : un seul <path>, aucun script ni référence externe, zone de silence de 4 modules", () => {
    const q = encodeQr(URL_TEXT);
    const svg = qrToSvg(q);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${q.size + 8} ${q.size + 8}"`);
    expect((svg.match(/<path /g) ?? []).length).toBe(1);
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/<script|href=|xlink|http:|https:|onload|<image/i);
    expect(svg).toBe(qrToSvg(q));
  });

  it("encode l'UTF-8 (accents) sans erreur", () => {
    expect(() => encodeQr("Élève à l'école : vérifié ✓")).not.toThrow();
  });
});
