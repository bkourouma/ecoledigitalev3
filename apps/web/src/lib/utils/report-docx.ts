/**
 * Rendu Word (.docx) d'un `ReportSpec` — même modèle que `report-pdf.ts` :
 * A4 paysage (ou portrait), en-tête institutionnel en tête de document donc sur
 * la première page seulement, tableaux verts à lignes zébrées dont la ligne de
 * titres se répète d'une page à l'autre, pied de page avec l'adresse du siège
 * et la pagination.
 *
 * Contrairement au PDF, le fichier est téléchargé : un .docx ne s'affiche pas
 * dans le navigateur, il s'ouvre dans Word / LibreOffice.
 */
import { loadPdfHeaderImages, type PdfImg } from "@/lib/pdf-image-loader";
import {
  INSTITUT,
  MINISTERE,
  REPUBLIQUE,
  FOOTER_ADDRESS,
  IPAM_GREEN,
  IPAM_GREEN_LIGHT,
} from "@/lib/bulletin-format";
import {
  PAGE_MARGIN_MM,
  resolveWidths,
  texteImprimable,
  usableWidth,
  type ReportBlock,
  type ReportSpec,
} from "@/lib/utils/report-doc";

/* docx attend des hexadécimaux sans « # ». */
const GREEN = IPAM_GREEN.replace("#", "");
const ZEBRA = IPAM_GREEN_LIGHT.replace("#", "");
const GRIS = "555555";
const FILET = "D2D2D2";

/** Times, comme le PDF. Tailles en demi-points : 19 = 9,5 pt. */
const FONT = "Times New Roman";

/** Charge le module docx à la demande (plusieurs centaines de Ko). */
const loadDocx = () => import("docx");
type Docx = Awaited<ReturnType<typeof loadDocx>>;

/* -------------------------------- Outils -------------------------------- */

/** Image d'en-tête convertie pour docx : la charge utile base64, sans préfixe. */
function imageRun(d: Docx, img: PdfImg | null, heightMm: number) {
  if (!img) return null;
  const height = Math.round((heightMm / 25.4) * 96);
  return new d.ImageRun({
    type: img.format === "PNG" ? "png" : "jpg",
    data: img.dataUrl.replace(/^data:[^,]+,/, ""),
    transformation: { width: Math.round(height * img.ratio), height },
  } as any);
}

const AUCUNE = (d: Docx) => ({ style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" });

/** Ligne de tableau sans bordure : sert à poser des blocs côte à côte. */
function ligneSansBordure(d: Docx, cellules: Array<{ width: number; children: any[] }>) {
  const n = AUCUNE(d);
  return new d.Table({
    width: { size: 100, type: d.WidthType.PERCENTAGE },
    borders: { top: n, bottom: n, left: n, right: n, insideHorizontal: n, insideVertical: n },
    rows: [
      new d.TableRow({
        children: cellules.map(
          (c) =>
            new d.TableCell({
              width: { size: c.width, type: d.WidthType.PERCENTAGE },
              borders: { top: n, bottom: n, left: n, right: n },
              children: c.children,
            })
        ),
      }),
    ],
  });
}

/** Paragraphe multi-lignes (le texte source sépare les lignes par « \n »). */
function multiligne(d: Docx, texte: string, opts: any = {}) {
  return new d.Paragraph({
    alignment: opts.alignment ?? d.AlignmentType.LEFT,
    spacing: opts.spacing,
    children: texte.split("\n").flatMap((ln, i, all) => {
      const runs: any[] = [
        new d.TextRun({ text: ln, bold: opts.bold, size: opts.size ?? 17, color: opts.color }),
      ];
      if (i < all.length - 1) runs.push(new d.TextRun({ break: 1 }));
      return runs;
    }),
  });
}

/* -------------------------------- En-tête ------------------------------- */

function enTete(d: Docx, spec: ReportSpec, imgs: { logoInstitut: PdfImg | null; embleme: PdfImg | null }) {
  const logo = imageRun(d, imgs.logoInstitut, 18);
  const embleme = imageRun(d, imgs.embleme, 16);

  const blocs: any[] = [
    ligneSansBordure(d, [
      { width: 50, children: [multiligne(d, MINISTERE)] },
      { width: 50, children: [multiligne(d, REPUBLIQUE, { alignment: d.AlignmentType.RIGHT })] },
    ]),
    ligneSansBordure(d, [
      {
        width: 25,
        children: [new d.Paragraph({ children: logo ? [logo] : [], spacing: { before: 120 } })],
      },
      {
        width: 50,
        children: [
          new d.Paragraph({
            alignment: d.AlignmentType.CENTER,
            spacing: { before: 240 },
            children: [new d.TextRun({ text: INSTITUT, bold: true, size: 26, color: GREEN })],
          }),
        ],
      },
      {
        width: 25,
        children: [
          new d.Paragraph({
            alignment: d.AlignmentType.RIGHT,
            spacing: { before: 120 },
            children: embleme ? [embleme] : [],
          }),
        ],
      },
    ]),
    new d.Paragraph({
      alignment: d.AlignmentType.CENTER,
      spacing: { before: 160, after: spec.subtitle ? 80 : 160 },
      border: {
        top: { style: d.BorderStyle.SINGLE, size: 6, color: GREEN, space: 4 },
        bottom: { style: d.BorderStyle.SINGLE, size: 6, color: GREEN, space: 4 },
        left: { style: d.BorderStyle.SINGLE, size: 6, color: GREEN, space: 8 },
        right: { style: d.BorderStyle.SINGLE, size: 6, color: GREEN, space: 8 },
      },
      children: [
        new d.TextRun({
          text: texteImprimable(spec.title).toUpperCase(),
          bold: true,
          size: 22,
          color: GREEN,
        }),
      ],
    }),
  ];

  if (spec.subtitle) {
    blocs.push(
      new d.Paragraph({
        alignment: d.AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new d.TextRun({ text: texteImprimable(spec.subtitle), size: 20 })],
      })
    );
  }

  blocs.push(
    ligneSansBordure(d, [
      {
        width: 50,
        children: [
          new d.Paragraph({
            children: [new d.TextRun({ text: texteImprimable(spec.metaLeft), size: 19, color: GRIS })],
          }),
        ],
      },
      {
        width: 50,
        children: [
          new d.Paragraph({
            alignment: d.AlignmentType.RIGHT,
            children: [new d.TextRun({ text: texteImprimable(spec.metaRight), size: 19, color: GRIS })],
          }),
        ],
      },
    ]),
    new d.Paragraph({
      spacing: { before: 60, after: 160 },
      border: { bottom: { style: d.BorderStyle.SINGLE, size: 8, color: GREEN, space: 1 } },
      children: [],
    })
  );

  return blocs;
}

/* --------------------------------- Blocs -------------------------------- */

function heading(d: Docx, texte: string, niveau: 1 | 2, note?: string) {
  if (niveau === 1) {
    // Bandeau plein vert, comme dans le PDF : ouvre une grande section.
    const n = AUCUNE(d);
    return new d.Table({
      width: { size: 100, type: d.WidthType.PERCENTAGE },
      borders: { top: n, bottom: n, left: n, right: n, insideHorizontal: n, insideVertical: n },
      rows: [
        new d.TableRow({
          children: [
            new d.TableCell({
              width: { size: 70, type: d.WidthType.PERCENTAGE },
              shading: { fill: GREEN, type: "clear", color: "auto" } as any,
              children: [
                new d.Paragraph({
                  spacing: { before: 40, after: 40 },
                  children: [
                    new d.TextRun({ text: texteImprimable(texte), bold: true, size: 24, color: "FFFFFF" }),
                  ],
                }),
              ],
            }),
            new d.TableCell({
              width: { size: 30, type: d.WidthType.PERCENTAGE },
              shading: { fill: GREEN, type: "clear", color: "auto" } as any,
              children: [
                new d.Paragraph({
                  alignment: d.AlignmentType.RIGHT,
                  spacing: { before: 40, after: 40 },
                  children: [
                    new d.TextRun({ text: texteImprimable(note), bold: true, size: 20, color: "FFFFFF" }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });
  }

  return new d.Paragraph({
    spacing: { before: 160, after: 60 },
    children: [
      new d.TextRun({ text: texteImprimable(texte), bold: true, size: 21, color: GREEN }),
      ...(note ? [new d.TextRun({ text: `    ${texteImprimable(note)}`, size: 19, color: GRIS })] : []),
    ],
  });
}

function keyValues(d: Docx, items: Array<[string, string]>, colonnes: 1 | 2 | 3) {
  // Un tableau Word sans ligne est invalide : on rend un paragraphe vide.
  if (items.length === 0) return new d.Paragraph({ children: [] });
  const filet = { style: d.BorderStyle.SINGLE, size: 2, color: FILET };
  const lignes: any[] = [];

  for (let i = 0; i < items.length; i += colonnes) {
    const tranche = items.slice(i, i + colonnes);
    const cellules: any[] = [];
    for (let j = 0; j < colonnes; j += 1) {
      const [label, valeur] = tranche[j] ?? ["", ""];
      cellules.push(
        new d.TableCell({
          width: { size: 40 / colonnes, type: d.WidthType.PERCENTAGE },
          borders: { top: filet, bottom: filet, left: filet, right: filet },
          children: [
            new d.Paragraph({
              spacing: { before: 20, after: 20 },
              children: [new d.TextRun({ text: texteImprimable(label), bold: true, size: 19, color: GREEN })],
            }),
          ],
        }),
        new d.TableCell({
          width: { size: 60 / colonnes, type: d.WidthType.PERCENTAGE },
          borders: { top: filet, bottom: filet, left: filet, right: filet },
          children: [
            new d.Paragraph({
              spacing: { before: 20, after: 20 },
              children: [new d.TextRun({ text: texteImprimable(valeur), size: 19 })],
            }),
          ],
        })
      );
    }
    lignes.push(new d.TableRow({ children: cellules }));
  }

  return new d.Table({
    width: { size: 100, type: d.WidthType.PERCENTAGE },
    borders: { top: filet, bottom: filet, left: filet, right: filet, insideHorizontal: filet, insideVertical: filet },
    rows: lignes,
  });
}

function table(d: Docx, t: { columns: any[]; rows: string[][]; footer?: string[] }, orientation: "landscape" | "portrait") {
  const mm = (v: number) => d.convertMillimetersToTwip(v);
  const largeurs = resolveWidths(t.columns, usableWidth(orientation));
  const filet = { style: d.BorderStyle.SINGLE, size: 2, color: FILET };
  const bordures = { top: filet, bottom: filet, left: filet, right: filet };

  const alignement = (a?: string) =>
    a === "center" ? d.AlignmentType.CENTER : a === "right" ? d.AlignmentType.RIGHT : d.AlignmentType.LEFT;

  const cellule = (texte: string, i: number, opts: { fond?: string; couleur?: string; gras?: boolean; align?: string }) =>
    new d.TableCell({
      width: { size: mm(largeurs[i]), type: d.WidthType.DXA },
      shading: opts.fond ? ({ fill: opts.fond, type: "clear", color: "auto" } as any) : undefined,
      borders: bordures,
      children: [
        new d.Paragraph({
          alignment: alignement(opts.align),
          spacing: { before: 30, after: 30 },
          children: [
            new d.TextRun({ text: texteImprimable(texte), bold: opts.gras, size: 19, color: opts.couleur }),
          ],
        }),
      ],
    });

  const enTeteLigne = new d.TableRow({
    // Le tableau reprend seul sur les pages suivantes : sans cela, ses colonnes
    // ne seraient plus identifiables.
    tableHeader: true,
    children: t.columns.map((col, i) =>
      cellule(col.header, i, { fond: GREEN, couleur: "FFFFFF", gras: true, align: "center" })
    ),
  });

  const lignes = t.rows.map(
    (row, r) =>
      new d.TableRow({
        children: t.columns.map((col, i) =>
          cellule(row[i] ?? "", i, { fond: r % 2 === 1 ? ZEBRA : undefined, align: col.align })
        ),
      })
  );

  if (t.footer) {
    lignes.push(
      new d.TableRow({
        children: t.columns.map((col, i) =>
          cellule(t.footer![i] ?? "", i, { fond: GREEN, couleur: "FFFFFF", gras: true, align: col.align })
        ),
      })
    );
  }

  return new d.Table({
    columnWidths: largeurs.map((w) => mm(w)),
    width: { size: mm(usableWidth(orientation)), type: d.WidthType.DXA },
    borders: { ...bordures, insideHorizontal: filet, insideVertical: filet },
    rows: [enTeteLigne, ...lignes],
  });
}

function bloc(d: Docx, b: ReportBlock, orientation: "landscape" | "portrait"): any[] {
  switch (b.kind) {
    case "heading":
      return [heading(d, b.text, b.level ?? 1, b.note), new d.Paragraph({ spacing: { after: 60 }, children: [] })];
    case "keyValues":
      return [keyValues(d, b.items, b.columns ?? 2), new d.Paragraph({ spacing: { after: 60 }, children: [] })];
    case "table":
      return [table(d, b.table, orientation), new d.Paragraph({ spacing: { after: 120 }, children: [] })];
    case "note":
      return [
        new d.Paragraph({
          spacing: { before: 40, after: 120 },
          children: [new d.TextRun({ text: texteImprimable(b.text), italics: true, size: 19, color: GRIS })],
        }),
      ];
    case "pageBreak":
      return [new d.Paragraph({ children: [new d.PageBreak()] })];
  }
}

/* ------------------------------- Pied de page --------------------------- */

function pied(d: Docx) {
  return new d.Footer({
    children: [
      new d.Paragraph({
        alignment: d.AlignmentType.CENTER,
        border: { top: { style: d.BorderStyle.SINGLE, size: 6, color: GREEN, space: 4 } },
        children: FOOTER_ADDRESS.split("\n").flatMap((ln, i, all) => {
          const runs: any[] = [new d.TextRun({ text: ln, size: 15, color: GRIS })];
          if (i < all.length - 1) runs.push(new d.TextRun({ break: 1 }));
          return runs;
        }),
      }),
      new d.Paragraph({
        alignment: d.AlignmentType.RIGHT,
        children: [
          new d.TextRun({ text: "Page ", size: 15, color: GRIS }),
          new d.TextRun({ children: [d.PageNumber.CURRENT], size: 15, color: GRIS }),
          new d.TextRun({ text: " / ", size: 15, color: GRIS }),
          new d.TextRun({ children: [d.PageNumber.TOTAL_PAGES], size: 15, color: GRIS }),
        ],
      }),
    ],
  });
}

/* ------------------------------ Assemblage ------------------------------ */

export async function buildReportDocx(spec: ReportSpec): Promise<{ blob: Blob; filename: string }> {
  const orientation = spec.orientation ?? "landscape";
  const [d, imgs] = await Promise.all([loadDocx(), loadPdfHeaderImages()]);
  const marge = d.convertMillimetersToTwip(PAGE_MARGIN_MM);

  const doc = new d.Document({
    creator: INSTITUT,
    title: spec.title,
    description: spec.subtitle ?? spec.title,
    styles: { default: { document: { run: { font: FONT, size: 19 } } } },
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation:
                orientation === "portrait" ? d.PageOrientation.PORTRAIT : d.PageOrientation.LANDSCAPE,
            },
            margin: { top: marge, bottom: marge, left: marge, right: marge },
          },
        },
        footers: { default: pied(d) },
        children: [
          ...enTete(d, spec, imgs),
          ...spec.blocks.flatMap((b) => bloc(d, b, orientation)),
        ],
      },
    ],
  });

  return { blob: await d.Packer.toBlob(doc), filename: `${spec.filename}.docx` };
}

/** Télécharge le rapport au format Word. */
export async function downloadReportDocx(spec: ReportSpec): Promise<void> {
  const [{ blob, filename }, { saveAs }] = await Promise.all([
    buildReportDocx(spec),
    import("file-saver"),
  ]);
  saveAs(blob, filename);
}
