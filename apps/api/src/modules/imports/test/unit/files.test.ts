/**
 * Tests de lecture et de SÉCURITÉ des fichiers : CSV, XLSX, type réel, zip-bomb, formules, macros, fichier corrompu,
 * mauvais type, DOCTYPE, chemins d'archive, plafonds, rapport d'erreurs neutralisé.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { FileRejectedError } from "../../domain/errors";
import { openUploadedFile, sniffFile } from "../../infrastructure/files/read";
import { DEFAULT_FILE_LIMITS, MIB, type FileLimits } from "../../infrastructure/files/types";
import { writeCsv, writeXlsx } from "../../infrastructure/files/write";
import { XmlScanner } from "../../infrastructure/files/xml";
import { bigSheetXml, csvOf, enc, handmadeXlsx, lieAboutUncompressedSize, STUDENT_HEADERS, studentRows, xlsxOf } from "../support/files";

const limits = (patch: Partial<FileLimits> = {}): FileLimits => ({ ...DEFAULT_FILE_LIMITS, ...patch });

async function readAll(bytes: Uint8Array, name: string, patch: Partial<FileLimits> = {}, sheet?: string) {
  const opened = await openUploadedFile(bytes, { fileName: name, ...(sheet ? { sheet } : {}) }, limits(patch));
  const rows = [];
  for await (const r of opened.reader.rows()) rows.push(r);
  return { ...opened, rows };
}

async function rejection(promise: Promise<unknown>): Promise<FileRejectedError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(FileRejectedError);
    return e as FileRejectedError;
  }
  throw new Error("Le fichier aurait dû être refusé.");
}

describe("CSV", () => {
  it("lit UTF-8 avec BOM, séparateur « ; », guillemets doublés et retours à la ligne dans un champ", async () => {
    const text = '﻿Matricule;Nom;Prénoms\r\nA1;"KONE";"Aminata ""Mina"""\r\nA2;TRAORE;"Ibrahim\nSeydou"\r\n\r\nA3;YAO;Koffi';
    const r = await readAll(enc(text), "eleves.csv");
    expect(r.reader.headers).toEqual(["Matricule", "Nom", "Prénoms"]);
    expect(r.rows.map((x) => x.cells)).toEqual([
      ["A1", "KONE", 'Aminata "Mina"'],
      ["A2", "TRAORE", "Ibrahim\nSeydou"],
      ["A3", "YAO", "Koffi"],
    ]);
    expect(r.rows.map((x) => x.rowNo)).toEqual([2, 3, 6]);
    expect(r.size).toBe(enc(text).length);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("détecte la virgule et la tabulation, et lit windows-1252 (accents)", async () => {
    expect((await readAll(enc("a,b,c\n1,2,3\n"), "x.csv")).rows[0]?.cells).toEqual(["1", "2", "3"]);
    expect((await readAll(enc("a\tb\n1\t2\n"), "x.txt")).rows[0]?.cells).toEqual(["1", "2"]);
    const latin1 = new Uint8Array([0x4e, 0x6f, 0x6d, 0x3b, 0x56, 0x69, 0x6c, 0x6c, 0x65, 0x0a, 0x4b, 0x6f, 0x6e, 0xe9, 0x3b, 0x4d, 0x61, 0x6e, 0xe9, 0x0a]);
    const r = await readAll(latin1, "x.csv");
    expect(r.rows[0]?.cells).toEqual(["Koné", "Mané"]);
  });

  it("garde le TEXTE d'une cellule qui commence par « = » (aucune évaluation, INV-S5)", async () => {
    const r = await readAll(enc('Nom;Note\n=1+1;"=HYPERLINK(""http://x"")"\n'), "x.csv");
    expect(r.rows[0]?.cells).toEqual(["=1+1", '=HYPERLINK("http://x")']);
  });

  it("renomme les en-têtes vides et en double, et refuse trop de lignes, trop de colonnes, fichier vide, guillemet non refermé", async () => {
    const r = await readAll(enc("Nom;Nom;;Age\nA;B;C;D\n"), "x.csv");
    expect(r.reader.headers).toEqual(["Nom", "Nom (2)", "Colonne C", "Age"]);
    expect(r.reader.warnings.map((w) => w.code)).toContain("imports.duplicate_header");

    const many = csvOf([["Nom"], ...Array.from({ length: 11 }, (_, i) => [`n${i}`])]);
    expect((await rejection(readAll(many, "x.csv", { maxRows: 10 }))).code).toBe("imports.too_many_rows");
    const wide = csvOf([Array.from({ length: 12 }, (_, i) => `c${i}`), Array.from({ length: 12 }, () => "x")]);
    expect((await rejection(readAll(wide, "x.csv", { maxColumns: 10 }))).code).toBe("imports.too_many_columns");
    expect((await rejection(readAll(new Uint8Array(0), "x.csv"))).code).toBe("imports.file_empty");
    expect((await rejection(readAll(enc("\n\n;;\n"), "x.csv"))).code).toBe("imports.no_header");
    expect((await rejection(readAll(enc('a;b\n"abc;d\n'), "x.csv"))).code).toBe("imports.file_corrupt");
  });

  it("tronque une cellule démesurée (la validation de ligne la refusera)", async () => {
    const r = await readAll(csvOf([["Nom"], ["x".repeat(5000)]]), "x.csv");
    expect(r.rows[0]?.cells[0]?.length).toBe(DEFAULT_FILE_LIMITS.maxCellChars + 1);
  });
});

describe("XLSX bien formé", () => {
  it("aller-retour d'un classeur écrit par le module (texte, accents, première feuille)", async () => {
    const bytes = await xlsxOf([STUDENT_HEADERS, ...studentRows(3)], "Élèves");
    const r = await readAll(bytes, "eleves.xlsx");
    expect(r.reader.kind).toBe("XLSX");
    expect(r.reader.sheetName).toBe("Élèves");
    expect(r.reader.headers).toEqual(STUDENT_HEADERS);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]?.cells[0]).toBe("TA-00001");
    expect(r.rows[0]?.rowNo).toBe(2);
  });

  it("lit chaînes partagées, nombres, cellules creuses et numéros de ligne du tableur", async () => {
    const bytes = await handmadeXlsx({
      sharedStrings: ["Matricule", "Nom", "Naissance", "KONE &amp; Fils", "A-1"],
      rows: [
        { r: 3, cells: [{ r: "A3", t: "s", v: "0" }, { r: "B3", t: "s", v: "1" }, { r: "D3", t: "s", v: "2" }] },
        { r: 4, cells: [{ r: "A4", t: "s", v: "4" }, { r: "B4", t: "s", v: "3" }, { r: "D4", v: "45123" }] },
        { r: 5, cells: [] },
        { r: 6, cells: [{ r: "A6", t: "inlineStr", is: "B-2" }, { r: "B6", t: "str", v: "TRAORE" }, { r: "C6", t: "b", v: "1" }] },
      ],
    });
    const r = await readAll(bytes, "x.xlsx");
    expect(r.reader.headers).toEqual(["Matricule", "Nom", "Colonne C", "Naissance"]);
    expect(r.reader.headerRowNo).toBe(3);
    expect(r.rows.map((x) => [x.rowNo, x.cells])).toEqual([
      [4, ["A-1", "KONE & Fils", "", "45123"]],
      [6, ["B-2", "TRAORE", "TRUE", ""]],
    ]);
  });

  it("choisit la feuille demandée, ignore les feuilles masquées par défaut, refuse une feuille inconnue", async () => {
    const bytes = await handmadeXlsx({ sheets: [{ name: "Cachée", state: "hidden" }, { name: "Visible" }], rows: [{ r: 1, cells: [{ r: "A1", t: "inlineStr", is: "H" }] }, { r: 2, cells: [{ r: "A2", t: "inlineStr", is: "v" }] }] });
    expect((await readAll(bytes, "x.xlsx")).reader.sheetName).toBe("Visible");
    expect((await readAll(bytes, "x.xlsx", {}, "cachée")).reader.sheetName).toBe("Cachée");
    expect((await rejection(readAll(bytes, "x.xlsx", {}, "Absente"))).code).toBe("imports.sheet_unknown");
  });

  it("refuse plus de lignes ou de colonnes que les plafonds", async () => {
    const bytes = await xlsxOf([["A"], ...Array.from({ length: 12 }, (_, i) => [`n${i}`])]);
    expect((await rejection(readAll(bytes, "x.xlsx", { maxRows: 10 }))).code).toBe("imports.too_many_rows");
    const wide = await xlsxOf([Array.from({ length: 12 }, (_, i) => `c${i}`), Array.from({ length: 12 }, () => "x")]);
    expect((await rejection(readAll(wide, "x.xlsx", { maxColumns: 10 }))).code).toBe("imports.too_many_columns");
  });
});

describe("XLSX : formules et macros (INV-S5)", () => {
  it("lit la valeur MISE EN CACHE d'une formule sans l'évaluer, et signale les formules", async () => {
    const bytes = await handmadeXlsx({
      rows: [
        { r: 1, cells: [{ r: "A1", t: "inlineStr", is: "Nom" }, { r: "B1", t: "inlineStr", is: "Total" }] },
        { r: 2, cells: [{ r: "A2", t: "inlineStr", is: "KONE" }, { r: "B2", f: "SUM(1,2)", v: "3" }] },
        { r: 3, cells: [{ r: "A3", t: "inlineStr", is: "YAO" }, { r: "B3", f: "HYPERLINK(&quot;http://evil&quot;)" }] },
        { r: 4, cells: [{ r: "A4", t: "str", f: "A2&amp;A3", v: "=cmd|' /C calc'!A0" }] },
      ],
    });
    const r = await readAll(bytes, "x.xlsx");
    expect(r.rows.map((x) => x.cells)).toEqual([
      ["KONE", "3"],
      ["YAO", ""],
      ["=cmd|' /C calc'!A0", ""],
    ]);
    const warning = r.reader.warnings.find((w) => w.code === "imports.formulas_ignored");
    expect(warning?.count).toBe(3);
  });

  it("ignore les macros (jamais exécutées) et avertit", async () => {
    const bytes = await handmadeXlsx({ macros: true, rows: [{ r: 1, cells: [{ r: "A1", t: "inlineStr", is: "H" }] }, { r: 2, cells: [{ r: "A2", t: "inlineStr", is: "v" }] }] });
    const r = await readAll(bytes, "classeur.xlsm");
    expect(r.rows[0]?.cells).toEqual(["v"]);
    expect(r.reader.warnings.map((w) => w.code)).toContain("imports.macros_ignored");
  });
});

describe("XLSX : fichiers hostiles", () => {
  it("refuse une zip-bomb par le taux de compression déclaré", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("xl/workbook.xml", "<workbook/>");
    zip.file("xl/worksheets/sheet1.xml", "0".repeat(60 * MIB));
    const bomb = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
    expect(bomb.length).toBeLessThan(200_000);
    const e = await rejection(readAll(bomb, "x.xlsx", { maxZipUncompressedBytes: 200 * MIB }));
    expect(e.code).toBe("imports.file_unsafe");
    expect(e.message).toMatch(/compression|volumineux/i);
  });

  it("refuse un classeur dont la taille décompressée DÉCLARÉE dépasse le plafond", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("xl/workbook.xml", "<workbook/>");
    zip.file("xl/worksheets/sheet1.xml", bigSheetXml(40_000));
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    expect((await rejection(readAll(bytes, "x.xlsx", { maxZipUncompressedBytes: 1 * MIB }))).code).toBe("imports.file_unsafe");
  });

  it("COMPTE la décompression réelle : un en-tête qui ment sur la taille n'échappe pas au plafond", async () => {
    const bytes = await handmadeXlsx({ rows: [], sheetXml: bigSheetXml(60_000, 6) });
    const lying = lieAboutUncompressedSize(bytes, 1000);
    const e = await rejection(readAll(lying, "x.xlsx", { maxZipUncompressedBytes: 1 * MIB, maxRows: 1_000_000 }));
    expect(e.code === "imports.file_unsafe" || e.code === "imports.file_corrupt", e.code).toBe(true);
  });

  it("refuse le DOCTYPE / ENTITY (expansion d'entités, « billion laughs »)", async () => {
    const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&lol2;</t></is></c></row></sheetData></worksheet>`;
    const bytes = await handmadeXlsx({ rows: [], sheetXml: laughs });
    const e = await rejection(readAll(bytes, "x.xlsx"));
    expect(e.code).toBe("imports.file_unsafe");
    const wb = await handmadeXlsx({ rows: [], workbookXml: `<!DOCTYPE x [<!ENTITY a "b">]><workbook/>` });
    expect((await rejection(readAll(wb, "x.xlsx"))).code).toBe("imports.file_unsafe");
  });

  it("refuse un chemin d'entrée interdit (« .. »)", async () => {
    const bytes = await handmadeXlsx({ rows: [{ r: 1, cells: [{ r: "A1", t: "inlineStr", is: "H" }] }], extraParts: { "../evil.xml": "x" } });
    expect((await rejection(readAll(bytes, "x.xlsx"))).code).toBe("imports.file_unsafe");
  });

  it("refuse trop d'entrées dans l'archive", async () => {
    const parts: Record<string, string> = {};
    for (let i = 0; i < 30; i += 1) parts[`xl/media/i${i}.xml`] = "x";
    const bytes = await handmadeXlsx({ rows: [{ r: 1, cells: [{ r: "A1", t: "inlineStr", is: "H" }] }], extraParts: parts });
    expect((await rejection(readAll(bytes, "x.xlsx", { maxZipEntries: 20 }))).code).toBe("imports.file_unsafe");
  });

  it("refuse une archive ZIP qui n'est pas un classeur Excel", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document/>");
    const docx = await zip.generateAsync({ type: "uint8array" });
    expect((await rejection(readAll(docx, "x.xlsx"))).code).toBe("imports.file_type_unsupported");
  });

  it("refuse un classeur corrompu ou tronqué", async () => {
    const good = await xlsxOf([["A"], ["1"]]);
    const e1 = await rejection(readAll(good.subarray(0, Math.floor(good.length / 2)), "x.xlsx"));
    expect(["imports.file_corrupt", "imports.file_type_unsupported"]).toContain(e1.code);
    const junk = new Uint8Array(500);
    junk.set([0x50, 0x4b, 0x03, 0x04]);
    const e2 = await rejection(readAll(junk, "x.xlsx"));
    expect(e2.code).toBe("imports.file_corrupt");
    const truncatedXml = await handmadeXlsx({ rows: [], sheetXml: `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1"` });
    expect((await rejection(readAll(truncatedXml, "x.xlsx"))).code).toMatch(/^imports\.file_(corrupt|unsafe|type_unsupported)$/);
  });
});

describe("type réel du fichier (INV-S1)", () => {
  const pdf = enc("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0]);

  it("refuse PDF, image, document OLE2 non Excel (sans flux Workbook), exécutable, même déguisés en .csv ou .xlsx", () => {
    for (const [bytes, name] of [[pdf, "notes.csv"], [png, "eleves.xlsx"], [ole, "eleves.xlsx"], [ole, "eleves.xls"], [exe, "setup.csv"]] as const) {
      expect(() => sniffFile(bytes, { fileName: name }), name).toThrowError(FileRejectedError);
    }
    expect(() => sniffFile(ole, { fileName: "a.xlsx" })).toThrowError(/\.xls/);
  });

  it("refuse une extension inconnue, un contenu binaire, du HTML / XML", () => {
    expect(() => sniffFile(enc("a;b\n1;2\n"), { fileName: "x.exe" })).toThrowError(/extension/);
    expect(() => sniffFile(new Uint8Array([97, 0, 98, 0, 1, 2]), { fileName: "x.csv" })).toThrowError(FileRejectedError);
    expect(() => sniffFile(enc("<html><body>x</body></html>"), { fileName: "x.csv" })).toThrowError(FileRejectedError);
    expect(() => sniffFile(enc("<?xml version='1.0'?><a/>"), { fileName: "x.csv" })).toThrowError(FileRejectedError);
  });

  it("refuse l'incohérence nom / contenu / type annoncé", async () => {
    const xlsx = await xlsxOf([["A"], ["1"]]);
    expect(() => sniffFile(xlsx, { fileName: "eleves.csv" })).toThrowError(/ZIP/);
    expect(() => sniffFile(enc("a;b\n1;2"), { fileName: "eleves.xlsx" })).toThrowError(/texte/);
    expect(() => sniffFile(enc("a;b\n1;2"), { fileName: "eleves.csv", contentType: "image/png" })).toThrowError(FileRejectedError);
    expect(() => sniffFile(enc("a;b\n1;2"), { fileName: "eleves.csv", contentType: "application/vnd.ms-excel" })).not.toThrow();
    expect(sniffFile(xlsx, { fileName: "eleves.xlsx", contentType: "application/octet-stream" }).kind).toBe("XLSX");
  });

  it("refuse un fichier trop gros avant tout traitement", async () => {
    const e = await rejection(readAll(csvOf([["A"], ["x".repeat(2000)]]), "x.csv", { maxBytes: 1000 }));
    expect(e.code).toBe("imports.file_too_large");
  });

  it("assainit le nom de fichier conservé", async () => {
    const r = await openUploadedFile(csvOf([["A"], ["1"]]), { fileName: "..\\..\\etc/pass\u0000wd<script>.csv" }, limits());
    expect(r.fileName).not.toMatch(/[\\/<>\u0000]/);
    expect(r.fileName.endsWith(".csv")).toBe(true);
  });
});

describe("lecteur XML", () => {
  it("décode les entités prédéfinies et numériques, CDATA, préfixes d'espaces de noms, balises coupées entre morceaux", () => {
    const scanner = new XmlScanner();
    const events = [
      ...scanner.push('<?xml version="1.0"?><x:root xmlns:x="u"><x:t a="1 &amp; 2">A &lt; B &#233;&#x41;<![CDATA[<raw>]]></x:t><x'),
      ...scanner.push(":e/></x:root>"),
    ];
    scanner.end();
    expect(events.filter((e) => e.type === "open").map((e) => (e.type === "open" ? e.name : ""))).toEqual(["root", "t", "e"]);
    expect(events.find((e) => e.type === "open" && e.name === "t")).toMatchObject({ attrs: { a: "1 & 2" } });
    expect(events.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.text : "")).join("")).toBe("A < B éA<raw>");
  });

  it("refuse un document trop profond ou tronqué", () => {
    const deep = "<a>".repeat(70);
    expect(() => new XmlScanner().push(deep)).toThrowError(FileRejectedError);
    const s = new XmlScanner();
    s.push("<a><b>");
    expect(() => s.end()).toThrowError(FileRejectedError);
  });
});

describe("fichiers de sortie : rapport neutralisé (INV-S7)", () => {
  it("préfixe d'une apostrophe toute valeur interprétable comme formule, en CSV", () => {
    const text = new TextDecoder().decode(writeCsv([["Valeur", "Ligne"], ["=1+1", "ok"], ["+cmd|' /C calc'!A0", "-5"], ['@SUM(A1)', 'a"b;c']]));
    expect(text).toContain("'=1+1");
    expect(text).toContain("'+cmd|' /C calc'!A0");
    expect(text).toContain("'@SUM(A1)");
    expect(text).toContain(";-5"); // nombre négatif simple : inchangé
    expect(text).toContain('"a""b;c"');
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(writeCsv([["a"]])).charCodeAt(0)).toBe(0xfeff);
  });

  it("écrit un XLSX en texte seulement (aucune formule), relisible", async () => {
    const bytes = await writeXlsx([{ name: "Rapport", rows: [["Valeur"], ["=1+1"], ["@SUM(A1)"], ["Kone & <Fils>"]] }]);
    const zip = await JSZip.loadAsync(bytes);
    const sheet = await (zip.file("xl/worksheets/sheet1.xml") as JSZip.JSZipObject).async("string");
    expect(sheet).not.toMatch(/<f[ >]/);
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain("'=1+1");
    expect(sheet).toContain("Kone &amp; &lt;Fils&gt;");
    const back = await readAll(bytes, "r.xlsx");
    expect(back.rows.map((r) => r.cells[0])).toEqual(["'=1+1", "'@SUM(A1)", "Kone & <Fils>"]);
  });
});
