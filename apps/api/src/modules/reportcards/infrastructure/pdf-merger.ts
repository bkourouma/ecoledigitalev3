/** Fusion de PDF (PDF combiné d'une classe) et post-traitement des métadonnées, par `pdf-lib` (déjà dépendance de l'API). */
import { PDFDocument } from "pdf-lib";
import type { PdfMerger } from "../application/ports";

export class PdfLibMerger implements PdfMerger {
  async merge(pdfs: readonly Uint8Array[]): Promise<{ pdf: Uint8Array; pages: number }> {
    const out = await PDFDocument.create({ updateMetadata: false });
    for (const bytes of pdfs) {
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      const pages = await out.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    out.setProducer("EcoleDigitale");
    out.setCreator("EcoleDigitale");
    return { pdf: await out.save({ useObjectStreams: false }), pages: out.getPageCount() };
  }
}

/**
 * Normalise les métadonnées d'un PDF : titre, producteur et DATES = date d'émission du document (reproductibilité, R-RC-08),
 * jamais la date du rendu.
 */
export async function stampPdfMetadata(pdf: Uint8Array, meta: { title: string; issuedAt: Date }): Promise<{ pdf: Uint8Array; pages: number }> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  doc.setTitle(meta.title);
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setProducer("EcoleDigitale");
  doc.setCreator("EcoleDigitale");
  doc.setCreationDate(meta.issuedAt);
  doc.setModificationDate(meta.issuedAt);
  return { pdf: await doc.save({ useObjectStreams: false }), pages: doc.getPageCount() };
}
