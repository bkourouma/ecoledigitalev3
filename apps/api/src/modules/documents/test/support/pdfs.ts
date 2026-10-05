/**
 * PDF de test RÉELS (pdf-lib, déjà présent dans apps/api) : avec texte (polices standard, accents WinAnsi), sans texte (scan
 * simulé : une page vide), piégés (actions automatiques, JavaScript, lancement, URI vers un port local), bombe de
 * décompression, très long. Aucun fichier sur disque.
 */
import { deflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream, PDFString, StandardFonts } from "pdf-lib";

/** PDF dont chaque élément de `pages` est le texte d'une page (lignes séparées par `\n`). */
export async function textPdf(pages: readonly string[], options: { title?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  if (options.title) doc.setTitle(options.title);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([595, 842]);
    let y = 780;
    for (const line of text.split("\n")) {
      page.drawText(line, { x: 50, y, size: 12, font });
      y -= 18;
    }
  }
  return doc.save();
}

/** PDF valide sans aucune couche de texte (équivalent d'un scan : pas d'OCR). */
export async function blankPdf(pageCount = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) doc.addPage([595, 842]);
  return doc.save();
}

/**
 * PDF piégé : texte lisible + ouverture automatique d'une URI vers `trapUrl`, JavaScript qui tente de joindre cette URL, action
 * de lancement d'un programme et actions additionnelles de page. Un analyseur correct n'exécute RIEN de tout cela.
 */
export async function trappedPdf(trapUrl: string, visibleText = "Contrat de travail confidentiel"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText(visibleText, { x: 50, y: 780, size: 12, font });
  const ctx = doc.context;
  const uri = ctx.obj({ Type: "Action", S: "URI", URI: PDFString.of(trapUrl) });
  const js = ctx.obj({ Type: "Action", S: "JavaScript", JS: PDFString.of(`app.launchURL("${trapUrl}", true); this.submitForm("${trapUrl}");`) });
  const launch = ctx.obj({ Type: "Action", S: "Launch", F: PDFString.of("cmd.exe"), Win: ctx.obj({ F: PDFString.of("cmd.exe"), P: PDFString.of("/c calc.exe") }) });
  doc.catalog.set(PDFName.of("OpenAction"), ctx.register(js));
  doc.catalog.set(PDFName.of("AA"), ctx.obj({ WC: ctx.register(uri), WS: ctx.register(launch) }));
  page.node.set(PDFName.of("AA"), ctx.obj({ O: ctx.register(uri), C: ctx.register(js) }));
  doc.catalog.set(PDFName.of("Names"), ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of("trap"), ctx.register(js)] }) }));
  return doc.save();
}

/** Bombe de décompression : un flux Flate de quelques centaines de Kio qui s'étend en `expandedBytes` octets de contenu de page. */
export async function bombPdf(expandedBytes: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const compressed = deflateSync(Buffer.alloc(expandedBytes, 0x20), { level: 9 });
  const stream = PDFRawStream.of(doc.context.obj({ Filter: "FlateDecode" }), new Uint8Array(compressed));
  page.node.set(PDFName.of("Contents"), doc.context.register(stream));
  return doc.save();
}

/** Octets qui commencent comme un PDF mais n'en sont pas un. */
export const corruptPdf = (): Uint8Array => new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 99 0 R >>\nendobj\n%%garbage\u0000\u0001 xref trailer << /Root 9 0 R >> startxref 0 %%EOF");
