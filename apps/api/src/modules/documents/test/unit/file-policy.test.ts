import { describe, expect, it } from "vitest";
import { checkFile, detectFileType, formatBytes, previewKindOf, resolveMime, sanitizeFileName, sha256Hex } from "../../domain/file-policy";
import { docxBytes, exeBytes, gifBytes, jpegBytes, oleBytes, odtBytes, pdfBytes, plainZipBytes, pngBytes, pptxBytes, textBytes, utf16le, webpBytes, xlsxBytes, zipBytes } from "../support/files";

const limits = (extensions: string[], maxBytes = 1_000_000) => ({ maxBytes, allowedExtensions: extensions });

describe("sanitizeFileName", () => {
  it("garde la composante finale et supprime tout chemin", () => {
    const r = sanitizeFileName("..\\..\\Windows\\System32\\rapport.pdf");
    expect(r).toMatchObject({ ok: true, fileName: "rapport.pdf" });
    expect(sanitizeFileName("/etc/passwd.pdf")).toMatchObject({ ok: true, fileName: "passwd.pdf" });
  });

  it("supprime les marques bidirectionnelles et caractères de contrôle (inversion d'extension)", () => {
    const r = sanitizeFileName("facture" + String.fromCharCode(0x202e) + "fdp.exe");
    // « facture<RLO>fdp.exe » s'afficherait « factureexe.pdf » : la marque est retirée, l'extension réelle (.exe) est conservée.
    expect(r).toMatchObject({ ok: true, fileName: "facturefdp.exe", extension: "exe" });
    expect(sanitizeFileName("a\u0000b\u0007.pdf")).toMatchObject({ ok: true, fileName: "ab.pdf" });
  });

  it("remplace les caractères réservés et normalise en NFC", () => {
    expect(sanitizeFileName('a<b>c:d"e|f?g*h.pdf')).toMatchObject({ ok: true, fileName: "a_b_c_d_e_f_g_h.pdf" });
    const decomposed = "été.pdf"; // « été » décomposé
    const r = sanitizeFileName(decomposed);
    expect(r.ok && r.fileName).toBe("été.pdf");
  });

  it("refuse l'extension intermédiaire dangereuse et l'absence d'extension", () => {
    expect(sanitizeFileName("facture.exe.pdf")).toMatchObject({ ok: false });
    expect(sanitizeFileName("page.php.jpg")).toMatchObject({ ok: false });
    expect(sanitizeFileName("lisez-moi")).toMatchObject({ ok: false });
    expect(sanitizeFileName(".pdf")).toMatchObject({ ok: false });
    expect(sanitizeFileName("   ")).toMatchObject({ ok: false });
  });

  it("autorise une version dans le nom (v1.2) et préfixe les noms réservés Windows", () => {
    expect(sanitizeFileName("notes v1.2.pdf")).toMatchObject({ ok: true, fileName: "notes v1.2.pdf" });
    expect(sanitizeFileName("CON.pdf")).toMatchObject({ ok: true, fileName: "_CON.pdf" });
  });

  it("tronque à 120 caractères en conservant l'extension", () => {
    const r = sanitizeFileName(`${"a".repeat(300)}.pdf`);
    expect(r.ok && r.fileName.length).toBe(120);
    expect(r.ok && r.fileName.endsWith(".pdf")).toBe(true);
  });

  it("retire points et espaces de bord (fichier caché, nom Windows invalide)", () => {
    expect(sanitizeFileName("...secret.pdf")).toMatchObject({ ok: true, fileName: "secret.pdf" });
    expect(sanitizeFileName("rapport .pdf ")).toMatchObject({ ok: true, fileName: "rapport.pdf" });
  });
});

describe("detectFileType : le contenu fait foi", () => {
  it("reconnaît PDF, JPEG, PNG, WebP, GIF", () => {
    expect(detectFileType(pdfBytes())).toMatchObject({ ok: true, type: { kind: "pdf", mime: "application/pdf" } });
    expect(detectFileType(jpegBytes())).toMatchObject({ ok: true, type: { kind: "jpeg" } });
    expect(detectFileType(pngBytes())).toMatchObject({ ok: true, type: { kind: "png" } });
    expect(detectFileType(webpBytes())).toMatchObject({ ok: true, type: { kind: "webp" } });
    expect(detectFileType(gifBytes())).toMatchObject({ ok: true, type: { kind: "gif" } });
  });

  it("distingue docx, xlsx, pptx et OpenDocument dans l'archive", () => {
    expect(detectFileType(docxBytes())).toMatchObject({ ok: true, type: { kind: "docx" } });
    expect(detectFileType(xlsxBytes())).toMatchObject({ ok: true, type: { kind: "xlsx" } });
    expect(detectFileType(pptxBytes())).toMatchObject({ ok: true, type: { kind: "pptx" } });
    expect(detectFileType(odtBytes())).toMatchObject({ ok: true, type: { kind: "odt", mime: "application/vnd.oasis.opendocument.text" } });
  });

  it("refuse les macros Office (OOXML et OLE) et les archives quelconques", () => {
    expect(detectFileType(docxBytes([{ name: "word/vbaProject.bin", content: "x" }]))).toMatchObject({ ok: false, code: "macro_content" });
    expect(detectFileType(oleBytes(utf16le("_VBA_PROJECT")))).toMatchObject({ ok: false, code: "macro_content" });
    expect(detectFileType(plainZipBytes())).toMatchObject({ ok: false, code: "type_not_allowed" });
  });

  it("refuse une bombe de décompression déclarée", () => {
    const bomb = zipBytes([{ name: "[Content_Types].xml", content: "<Types/>", declaredSize: 2_000_000_000 }, { name: "word/document.xml" }]);
    expect(detectFileType(bomb)).toMatchObject({ ok: false, code: "type_not_allowed" });
  });

  it("refuse un exécutable, un HTML ou un SVG déguisés en texte", () => {
    expect(detectFileType(exeBytes())).toMatchObject({ ok: false, code: "type_undetected" });
    expect(detectFileType(textBytes("<html><script>alert(1)</script></html>"))).toMatchObject({ ok: false, code: "type_undetected" });
    expect(detectFileType(textBytes('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toMatchObject({ ok: false });
    expect(detectFileType(textBytes("<?xml version='1.0'?><a/>"))).toMatchObject({ ok: false });
    expect(detectFileType(new Uint8Array(0))).toMatchObject({ ok: false });
  });

  it("accepte un texte UTF-8 (csv, txt) et refuse un binaire quelconque", () => {
    expect(detectFileType(textBytes("matricule;nom\n1;Awa\n"))).toMatchObject({ ok: true, type: { kind: "text" } });
    expect(detectFileType(Uint8Array.from([0xff, 0xfe, 0x00, 0x41, 0x00]))).toMatchObject({ ok: false });
  });
});

describe("checkFile : cohérence extension / contenu, liste blanche, taille", () => {
  const pdfAndImages = limits(["pdf", "jpg", "jpeg", "png"]);

  it("accepte un PDF et calcule son SHA-256 et son nom assaini", () => {
    const bytes = pdfBytes();
    const r = checkFile({ fileName: "Dossier/CNI Awa.PDF", bytes }, pdfAndImages);
    expect(r).toMatchObject({ ok: true, fileName: "CNI Awa.pdf", extension: "pdf", mime: "application/pdf", size: bytes.length });
    expect(r.ok && r.sha256).toBe(sha256Hex(bytes));
  });

  it("AC-1 : un JPEG nommé .pdf est refusé (le contenu fait foi)", () => {
    expect(checkFile({ fileName: "scan.pdf", bytes: jpegBytes() }, pdfAndImages)).toMatchObject({ ok: false, code: "type_mismatch" });
  });

  it("AC-1 : un exécutable renommé .pdf ou .jpg est refusé", () => {
    expect(checkFile({ fileName: "photo.jpg", bytes: exeBytes() }, pdfAndImages)).toMatchObject({ ok: false, code: "type_undetected" });
    expect(checkFile({ fileName: "setup.pdf", bytes: exeBytes() }, pdfAndImages)).toMatchObject({ ok: false });
  });

  it("refuse une extension absente de la liste blanche de la catégorie même si le contenu est sain", () => {
    expect(checkFile({ fileName: "budget.xlsx", bytes: xlsxBytes() }, pdfAndImages)).toMatchObject({ ok: false, code: "type_not_allowed" });
    expect(checkFile({ fileName: "budget.xlsx", bytes: xlsxBytes() }, limits(["xlsx"]))).toMatchObject({ ok: true, mime: expect.stringContaining("spreadsheetml") });
  });

  it("une extension doc / xls / ppt prend son MIME de l'extension (en-tête OLE commun)", () => {
    expect(checkFile({ fileName: "ancien.doc", bytes: oleBytes() }, limits(["doc", "xls"]))).toMatchObject({ ok: true, mime: "application/msword" });
    expect(checkFile({ fileName: "tableau.xls", bytes: oleBytes() }, limits(["doc", "xls"]))).toMatchObject({ ok: true, mime: "application/vnd.ms-excel" });
    expect(checkFile({ fileName: "x.pdf", bytes: oleBytes() }, limits(["pdf"]))).toMatchObject({ ok: false, code: "type_mismatch" });
  });

  it("taille : vide et trop grand refusés avant tout autre contrôle", () => {
    expect(checkFile({ fileName: "a.pdf", bytes: new Uint8Array(0) }, pdfAndImages)).toMatchObject({ ok: false, code: "file_empty" });
    expect(checkFile({ fileName: "a.pdf", bytes: pdfBytes() }, limits(["pdf"], 10))).toMatchObject({ ok: false, code: "file_too_large" });
  });

  it("nom piégé refusé même avec un contenu sain", () => {
    expect(checkFile({ fileName: "facture.exe.pdf", bytes: pdfBytes() }, pdfAndImages)).toMatchObject({ ok: false, code: "file_name_rejected" });
  });

  it("un texte .csv est typé text/csv ; .txt text/plain", () => {
    expect(checkFile({ fileName: "notes.csv", bytes: textBytes() }, limits(["csv", "txt"]))).toMatchObject({ ok: true, mime: "text/csv" });
    expect(checkFile({ fileName: "notes.txt", bytes: textBytes() }, limits(["csv", "txt"]))).toMatchObject({ ok: true, mime: "text/plain" });
  });
});

describe("utilitaires", () => {
  it("resolveMime : OLE selon l'extension", () => {
    const d = detectFileType(oleBytes());
    if (!d.ok) throw new Error("attendu");
    expect(resolveMime(d.type, "ppt")).toBe("application/vnd.ms-powerpoint");
  });
  it("previewKindOf : images, PDF, texte, Office, reste", () => {
    expect(previewKindOf("image/png")).toBe("IMAGE");
    expect(previewKindOf("application/pdf")).toBe("PDF");
    expect(previewKindOf("text/csv")).toBe("TEXT");
    expect(previewKindOf("application/msword")).toBe("OFFICE");
    expect(previewKindOf("image/tiff")).toBe("NONE");
  });
  it("formatBytes en français", () => {
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 Mo");
    expect(formatBytes(1536)).toBe("2 Ko");
    expect(formatBytes(12)).toBe("12 o");
  });
});
