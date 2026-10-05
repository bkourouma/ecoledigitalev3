/**
 * Tests du convertisseur ISOLÉ des classeurs .xls et .ods (O-11) : lecture normalisée, détection du type par le contenu,
 * fichiers piégés (bombe de décompression, trop de lignes / colonnes / feuilles, faux .xls, .ods avec liens, entités
 * externes), délai maximal (processus tué), mémoire et sortie plafonnées, aucun secret ni réseau dans l'enfant,
 * conversions simultanées sans mélange.
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FileRejectedError } from "../../domain/errors";
import { openUploadedFile, sniffFile } from "../../infrastructure/files/read";
import { probeConverterSandbox } from "../../infrastructure/files/legacy/convert";
import { DEFAULT_FILE_LIMITS, MIB, type FileLimits } from "../../infrastructure/files/types";
import { enc, STUDENT_HEADERS, studentRows, xlsxOf } from "../support/files";
import { corruptXls, fakeOle2, handmadeOds, lieAboutEntrySize, odsCell, odsOf, odsRow, odsSheets, xlsOf, xlsSheets } from "../support/legacy-files";

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

const TABLE = [STUDENT_HEADERS, ...studentRows(5)];

describe("lecture normalisée : même format interne que .xlsx", () => {
  it.each([
    ["XLS", "eleves.xls", () => xlsOf(TABLE, "Élèves")],
    ["ODS", "eleves.ods", () => odsOf(TABLE, "Élèves")],
  ] as const)("%s : en-têtes, lignes, numéros de ligne, nom de feuille", async (kind, name, make) => {
    const r = await readAll(make(), name);
    expect(r.reader.kind).toBe(kind);
    expect(r.reader.sheetName).toBe("Élèves");
    expect(r.reader.headers).toEqual(STUDENT_HEADERS);
    expect(r.rows.map((x) => x.cells)).toEqual(studentRows(5));
    expect(r.rows.map((x) => x.rowNo)).toEqual([2, 3, 4, 5, 6]);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("donne exactement les mêmes lignes que le même tableau en .xlsx, en .xls et en .ods (nombres, booléens, texte, accents)", async () => {
    const table = [
      ["Texte", "Entier", "Décimal", "Grand", "Booléen", "Vide", "Dernier"],
      ["Élève Ñ", 12, 12.5, 1234567890123, true, null, "fin"],
      ["  espaces  ", 0, 0.1, 100000, false, null, "x"],
    ];
    const xlsx = await readAll(await xlsxOf(table.map((r) => r.map((c) => (c === null ? "" : c)) as never)), "t.xlsx");
    const xls = await readAll(xlsOf(table), "t.xls");
    const ods = await readAll(odsOf(table), "t.ods");
    // Le rédacteur .xlsx du module écrit les booléens en texte minuscule ; un vrai classeur les lit « TRUE » / « FALSE » (INV-S5).
    const expected = xlsx.rows.map((r) => r.cells.map((c) => (c === "true" ? "TRUE" : c === "false" ? "FALSE" : c)));
    expect(xls.rows.map((r) => r.cells)).toEqual(expected);
    expect(ods.rows.map((r) => r.cells)).toEqual(expected);
    expect(xls.reader.headers).toEqual(xlsx.reader.headers);
    expect(ods.reader.headers).toEqual(xlsx.reader.headers);
  });

  it("lit la feuille visible par défaut, ou celle demandée (sans tenir compte de la casse) ; refuse une feuille inconnue", async () => {
    for (const [make, name] of [
      [xlsSheets, "x.xls"],
      [odsSheets, "x.ods"],
    ] as const) {
      const bytes = make([
        { name: "Cachée", rows: [["H"], ["secret"]], hidden: true },
        { name: "Visible", rows: [["H"], ["v"]] },
      ]);
      if (name === "x.xls") {
        expect((await readAll(bytes, name)).reader.sheetName).toBe("Visible");
        expect((await readAll(bytes, name)).rows[0]?.cells).toEqual(["v"]);
      }
      expect((await readAll(bytes, name, {}, "cachée")).rows[0]?.cells).toEqual(["secret"]);
      const e = await rejection(readAll(bytes, name, {}, "Absente"));
      expect(e.code).toBe("imports.sheet_unknown");
    }
  });

  it("renomme les en-têtes vides et en double comme les autres formats, ignore les lignes vides, tronque une cellule démesurée", async () => {
    const r = await readAll(odsOf([["Nom", "Nom", null, "Age"], ["A", "B", "C", "D"], [null, null, null, null], ["x".repeat(5000), "", "", ""]]), "x.ods");
    expect(r.reader.headers).toEqual(["Nom", "Nom (2)", "Colonne C", "Age"]);
    expect(r.reader.warnings.map((w) => w.code)).toContain("imports.duplicate_header");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[1]?.cells[0]?.length).toBe(DEFAULT_FILE_LIMITS.maxCellChars + 1);
  });

  it("refuse un classeur sans en-têtes", async () => {
    expect((await rejection(readAll(xlsOf([[null]]), "x.xls"))).code).toMatch(/^imports\.(no_header|file_corrupt)$/);
  });
});

describe("type détecté par le CONTENU (magic bytes), pas par l'extension", () => {
  const xls = xlsOf([["A"], ["1"]]);
  const ods = odsOf([["A"], ["1"]]);

  it("reconnaît .xls et .ods sur les octets, avec ou sans extension", async () => {
    expect(sniffFile(xls, { fileName: "eleves.xls" }).kind).toBe("XLS");
    expect(sniffFile(xls, { fileName: "eleves" }).kind).toBe("XLS");
    expect(sniffFile(ods, { fileName: "eleves.ods" }).kind).toBe("ODS");
    expect(sniffFile(await handmadeOds(), { fileName: "eleves" }).kind).toBe("ODS");
    expect(sniffFile(await xlsxOf([["A"], ["1"]]), { fileName: "eleves.xlsx" }).kind).toBe("XLSX");
  });

  it("refuse toute incohérence nom / contenu : faux .xls, faux .ods, faux .xlsx", async () => {
    const xlsx = await xlsxOf([["A"], ["1"]]);
    const realOds = await handmadeOds(); // `mimetype` en première entrée, comme LibreOffice
    const cases: Array<[string, Uint8Array, string, string]> = [
      ["texte nommé .xls", enc("a;b\n1;2\n"), "eleves.xls", "imports.file_type_mismatch"],
      ["texte nommé .ods", enc("a;b\n1;2\n"), "eleves.ods", "imports.file_type_mismatch"],
      ["xlsx nommé .xls", xlsx, "eleves.xls", "imports.file_type_mismatch"],
      ["xlsx nommé .ods", xlsx, "eleves.ods", "imports.file_type_mismatch"],
      ["xls nommé .xlsx", xls, "eleves.xlsx", "imports.file_type_mismatch"],
      ["xls nommé .csv", xls, "eleves.csv", "imports.file_type_mismatch"],
      ["ods nommé .xlsx", realOds, "eleves.xlsx", "imports.file_type_mismatch"],
      ["ods nommé .xls", realOds, "eleves.xls", "imports.file_type_mismatch"],
      ["document OLE2 non Excel nommé .xls", fakeOle2(), "eleves.xls", "imports.file_type_unsupported"],
      ["document OLE2 non Excel nommé .xlsx", fakeOle2(), "eleves.xlsx", "imports.file_type_unsupported"],
      ["PDF nommé .xls", enc("%PDF-1.7\n1 0 obj\n"), "eleves.xls", "imports.file_type_unsupported"],
      ["exécutable nommé .ods", new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]), "eleves.ods", "imports.file_type_unsupported"],
      ["extension inconnue", xls, "eleves.dat", "imports.file_type_unsupported"],
      ["type annoncé image", xls, "eleves.xls", "imports.file_type_mismatch"],
    ];
    for (const [label, bytes, name, code] of cases) {
      const contentType = label === "type annoncé image" ? "image/png" : undefined;
      const e = await rejection(openUploadedFile(bytes, { fileName: name, contentType }, limits()));
      expect(e.code, label).toBe(code);
    }
  });

  it("refuse un .ods dont la partie « mimetype » n'est pas un tableur (un .odt n'est pas importable)", async () => {
    const odt = await handmadeOds({ mimetype: "application/vnd.oasis.opendocument.text" });
    expect((await rejection(readAll(odt, "lettre.ods"))).code).toBe("imports.file_type_mismatch");
    const noMime = await handmadeOds({ mimetype: null });
    expect((await rejection(readAll(noMime, "x.ods"))).code).toBe("imports.file_type_mismatch");
    const noContent = await handmadeOds({ noContent: true });
    expect((await rejection(readAll(noContent, "x.ods"))).code).toBe("imports.file_corrupt");
  });

  it("refuse un faux .xls (flux Excel annoncé, contenu de bruit) et un .xls ou .ods tronqués : erreurs claires, jamais d'erreur interne", async () => {
    expect((await rejection(readAll(corruptXls(), "x.xls"))).code).toMatch(/^imports\.(file_corrupt|no_header)$/);
    const half = xls.subarray(0, Math.floor(xls.length / 2));
    expect((await rejection(readAll(half, "x.xls"))).code).toMatch(/^imports\.(file_corrupt|file_type_unsupported|no_header)$/);
    expect((await rejection(readAll(ods.subarray(0, Math.floor(ods.length / 2)), "x.ods"))).code).toBe("imports.file_corrupt");
    expect((await rejection(readAll(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), "x.ods"))).code).toBe("imports.file_corrupt");
  });
});

describe("plafonds : lignes, colonnes, feuilles, taille", () => {
  it("refuse trop de lignes, trop de colonnes, trop de feuilles et un fichier trop gros", async () => {
    const many = [["A"], ...Array.from({ length: 80 }, (_, i) => [`n${i}`])];
    for (const [bytes, name] of [
      [xlsOf(many), "x.xls"],
      [odsOf(many), "x.ods"],
    ] as const) {
      const e = await rejection(readAll(bytes, name, { maxRows: 10 }));
      expect(e.code).toBe("imports.too_many_rows");
    }
    const wide = [Array.from({ length: 30 }, (_, i) => `c${i}`), Array.from({ length: 30 }, () => "x")];
    expect((await rejection(readAll(xlsOf(wide), "x.xls", { maxColumns: 10 }))).code).toBe("imports.too_many_columns");
    expect((await rejection(readAll(odsOf(wide), "x.ods", { maxColumns: 10 }))).code).toBe("imports.too_many_columns");

    const sheets = Array.from({ length: 6 }, (_, i) => ({ name: `F${i + 1}`, rows: [["A"], ["1"]] }));
    for (const [bytes, name] of [
      [xlsSheets(sheets), "x.xls"],
      [odsSheets(sheets), "x.ods"],
    ] as const) {
      const e = await rejection(readAll(bytes, name, { legacy: { maxSheets: 5 } }));
      expect(e.code).toBe("imports.file_unsafe");
      expect(e.message).toMatch(/trop de feuilles/);
    }
    expect((await rejection(readAll(xlsOf(many), "x.xls", { maxBytes: 1000 }))).code).toBe("imports.file_too_large");
  });

  it("accepte exactement le maximum de lignes et refuse une ligne de plus", async () => {
    const rows = (n: number) => [["A"], ...Array.from({ length: n }, (_, i) => [`n${i}`])];
    expect((await readAll(xlsOf(rows(10)), "x.xls", { maxRows: 10 })).rows).toHaveLength(10);
    expect((await readAll(odsOf(rows(10)), "x.ods", { maxRows: 10 })).rows).toHaveLength(10);
    expect((await rejection(readAll(xlsOf(rows(11)), "x.xls", { maxRows: 10 }))).code).toBe("imports.too_many_rows");
    expect((await rejection(readAll(odsOf(rows(11)), "x.ods", { maxRows: 10 }))).code).toBe("imports.too_many_rows");
  });
});

describe("archives .ods piégées (INV-S3 étendu)", () => {
  it("bombe de décompression : content.xml de 40 Mio de répétitions dans quelques Kio -> refusée AVANT toute conversion", async () => {
    const bomb = new JSZip();
    bomb.file("mimetype", "application/vnd.oasis.opendocument.spreadsheet", { compression: "STORE" });
    bomb.file("content.xml", "<office:document-content>" + "<table:table-cell/>".repeat(2_000_000) + "</office:document-content>", { compression: "DEFLATE" });
    const bytes = await bomb.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
    expect(bytes.length).toBeLessThan(500_000);
    const e = await rejection(readAll(bytes, "bombe.ods"));
    expect(e.code).toBe("imports.file_unsafe");
  });

  it("taille déclarée mensongère : la décompression réelle est comptée et interrompue", async () => {
    const bomb = new JSZip();
    bomb.file("mimetype", "application/vnd.oasis.opendocument.spreadsheet", { compression: "STORE" });
    bomb.file("content.xml", "<x>" + "<a/>".repeat(1_000_000) + "</x>", { compression: "DEFLATE" });
    const honest = await bomb.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
    const lying = lieAboutEntrySize(honest, "content.xml", 100);
    const e = await rejection(readAll(lying, "mensonge.ods", { maxZipUncompressedBytes: 1 * MIB }));
    expect(["imports.file_unsafe", "imports.file_corrupt"]).toContain(e.code);
  });

  it("trop d'entrées et chemin d'entrée interdit", async () => {
    const many = await handmadeOds({ extraParts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`Pictures/p${i}.png`, "x"])) });
    expect((await rejection(readAll(many, "x.ods", { maxZipEntries: 20 }))).code).toBe("imports.file_unsafe");
    const traversal = await handmadeOds({ extraParts: { "../../evil.txt": "x" } });
    expect((await rejection(readAll(traversal, "x.ods"))).code).toBe("imports.file_unsafe");
  });

  it("macros : signalées, ignorées, jamais exécutées", async () => {
    const r = await readAll(await handmadeOds({ macros: true, rowsXml: odsRow(odsCell("Nom")) + odsRow(odsCell("KONE")) }), "m.ods");
    expect(r.reader.warnings.map((w) => w.code)).toContain("imports.macros_ignored");
    expect(r.rows[0]?.cells).toEqual(["KONE"]);
  });
});

describe("aucune formule évaluée, aucun lien suivi, aucune entité externe résolue", () => {
  let server: Server;
  let hits = 0;
  let baseUrl = "";
  let dir = "";
  const canary = "CANARY-SECRET-0f8d-contenu-de-fichier-local";

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "imports-legacy-"));
    writeFileSync(path.join(dir, "secret.txt"), canary);
    server = createServer((_req, res) => {
      hits += 1;
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it(".ods avec liens hypertextes et formules réseau : valeurs lues, liens comptés, AUCUNE requête émise", async () => {
    const content =
      `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2"><office:body><office:spreadsheet><table:table table:name="Feuil1">` +
      odsRow(odsCell("Nom"), odsCell("Note")) +
      odsRow(`<table:table-cell office:value-type="string"><text:p><text:a xlink:href="${baseUrl}/lien" xlink:type="simple">KONE</text:a></text:p></table:table-cell>`, `<table:table-cell table:formula="of:=WEBSERVICE(&quot;${baseUrl}/formule&quot;)" office:value-type="float" office:value="14"><text:p>14</text:p></table:table-cell>`) +
      odsRow(`<table:table-cell table:formula="of:=HYPERLINK(&quot;${baseUrl}/h&quot;)" office:value-type="string" office:string-value="TRAORE"><text:p>TRAORE</text:p></table:table-cell>`, odsCell("9")) +
      `</table:table></office:spreadsheet></office:body></office:document-content>`;
    const r = await readAll(await handmadeOds({ contentXml: content }), "liens.ods");
    expect(r.rows.map((x) => x.cells[1])).toEqual(["14", "9"]);
    expect(r.rows[0]?.cells[0]).toContain("KONE");
    const codes = r.reader.warnings.map((w) => w.code);
    expect(codes).toContain("imports.formulas_ignored");
    expect(hits).toBe(0);
  });

  it(".xls avec formules et liens : valeur enregistrée lue, liens signalés, aucune requête émise", async () => {
    const bytes = xlsSheets([{ name: "F", rows: [["Nom", "Note"], ["KONE", 14], ["TRAORE", 9]], formulas: { B2: `WEBSERVICE("${baseUrl}/x")` }, links: { A2: `${baseUrl}/lien`, A3: `file:///etc/passwd` } }]);
    const r = await readAll(bytes, "liens.xls");
    expect(r.rows.map((x) => x.cells)).toEqual([["KONE", "14"], ["TRAORE", "9"]]);
    const codes = r.reader.warnings.map((w) => w.code);
    expect(codes).toContain("imports.links_ignored");
    expect(hits).toBe(0);
  });

  it("entité externe XML (XXE) dans content.xml : jamais résolue, le contenu du fichier local ne fuit pas", async () => {
    const fileUrl = `file:///${path.join(dir, "secret.txt").replace(/\\/g, "/")}`;
    const content =
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE office:document-content [<!ENTITY xxe SYSTEM "${fileUrl}"><!ENTITY net SYSTEM "${baseUrl}/xxe">]>` +
      `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet><table:table table:name="Feuil1">` +
      odsRow(odsCell("Nom")) +
      odsRow(odsCell("&xxe;")) +
      odsRow(odsCell("&net;")) +
      `</table:table></office:spreadsheet></office:body></office:document-content>`;
    let serialized = "";
    try {
      const r = await readAll(await handmadeOds({ contentXml: content }), "xxe.ods");
      serialized = JSON.stringify(r.rows);
    } catch (e) {
      expect(e).toBeInstanceOf(FileRejectedError);
    }
    expect(serialized).not.toContain(canary);
    expect(hits).toBe(0);
  });
});

describe("délai, mémoire et sortie bornés : l'enfant est tué", () => {
  it("dépassement de délai : processus tué, fichier refusé rapidement avec un message clair", async () => {
    const started = Date.now();
    const e = await rejection(readAll(xlsOf(TABLE), "x.xls", { legacy: { timeoutMs: 20 } }));
    expect(e.code).toBe("imports.file_unsafe");
    expect(e.message).toMatch(/trop de temps/);
    expect(e.details).toMatchObject({ reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(5000);
    // Le service continue de fonctionner après un enfant tué.
    expect((await readAll(xlsOf(TABLE), "ok.xls")).rows).toHaveLength(5);
  });

  it("tas de l'enfant plafonné : un classeur qui l'épuise est refusé, pas une erreur interne", async () => {
    const e = await rejection(readAll(xlsOf(TABLE), "x.xls", { legacy: { maxHeapMb: 1 } }));
    expect(e.code).toBe("imports.file_unsafe");
  });

  it("sortie normalisée plafonnée : trop de contenu -> refusé", async () => {
    const big = [["A"], ...Array.from({ length: 300 }, (_, i) => ["x".repeat(200) + i])];
    const e = await rejection(readAll(xlsOf(big), "x.xls", { legacy: { maxOutputBytes: 4_000 } }));
    expect(e.code).toBe("imports.file_unsafe");
  });
});

describe("isolation du processus enfant", () => {
  it("n'hérite d'aucune variable d'environnement (secrets), n'a aucun module réseau ni processus, ne peut rien écrire", async () => {
    process.env["IMPORTS_TEST_FAKE_SECRET"] = "valeur-factice-ne-doit-pas-fuiter";
    process.env["DATABASE_URL"] = "valeur-factice-base-ne-doit-pas-fuiter";
    process.env["NODE_OPTIONS"] = "--max-old-space-size=4096";
    try {
      const report = await probeConverterSandbox();
      // Aucune variable du parent : ni les secrets factices ci-dessus, ni NODE_OPTIONS. (Windows ajoute lui-même quelques
      // variables système par défaut, sans lien avec le processus parent ; ailleurs l'environnement est VIDE.)
      for (const k of ["IMPORTS_TEST_FAKE_SECRET", "DATABASE_URL", "NODE_OPTIONS", "JWT_SECRET", "STORAGE_S3_SECRET_ACCESS_KEY"]) expect(report.envKeys).not.toContain(k);
      if (process.platform !== "win32") expect(report.envKeys).toEqual([]);
      for (const name of ["net", "tls", "dns", "dgram", "http", "https", "child_process", "worker_threads", "vm"]) {
        expect(report.blockedModules[name], `module ${name}`).toBe(true);
      }
      // Modèle de permissions de Node (Node 20+ : expérimental ; 22.13+ / 23.5+ : stable) : disque verrouillé.
      if (report.permissionModel) {
        expect(report.canWriteFile).toBe(false);
        expect(report.canReadOutsideDependencies).toBe(false);
      }
    } finally {
      delete process.env["IMPORTS_TEST_FAKE_SECRET"];
      delete process.env["DATABASE_URL"];
      delete process.env["NODE_OPTIONS"];
    }
  });

  it("conversions simultanées de fichiers de plusieurs établissements : aucune ligne ne passe d'une conversion à l'autre", async () => {
    const tenants = ["A", "B", "C", "D", "E", "F"];
    const results = await Promise.all(
      tenants.map((t, i) => {
        const rows = [["Matricule", "Nom"], ...Array.from({ length: 20 }, (_, n) => [`${t}-${n}`, `ELEVE-${t}`])];
        return readAll(i % 2 === 0 ? xlsOf(rows) : odsOf(rows), i % 2 === 0 ? "x.xls" : "x.ods", { legacy: { maxConcurrent: 2 } });
      }),
    );
    results.forEach((r, i) => {
      const t = tenants[i] as string;
      expect(r.rows).toHaveLength(20);
      expect(r.rows.every((row) => row.cells[0]?.startsWith(`${t}-`) && row.cells[1] === `ELEVE-${t}`)).toBe(true);
    });
  });
});
