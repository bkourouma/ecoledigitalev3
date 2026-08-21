/**
 * Génération de l'emploi du temps au format Word (.docx), mise en page proche du
 * modèle officiel : en-tête institution + grille hebdomadaire (HORAIRES × jours),
 * avec fusion verticale des cours sur plusieurs créneaux.
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  VerticalMerge,
  HeadingLevel,
  BorderStyle,
  ImageRun,
} from "docx";
import { saveAs } from "file-saver";
import {
  JOURS,
  DAY_KEYS,
  INDIGO,
  INDIGO_LIGHT,
  INDIGO_DARK,
  GRID_BORDER,
  MINISTERE,
  REPUBLIQUE,
  INSTITUT,
  ueColor,
  teacherName,
  roomLabel,
  buildOccupancy,
  displayedHours,
  plageHoraire,
  enTeteEmploiTemps,
} from "./emploi-temps-model";

// Paragraphe multi-lignes (sépare sur \n).
function multiline(text: string, opts: any = {}) {
  const lines = text.split("\n");
  return new Paragraph({
    alignment: opts.alignment ?? AlignmentType.LEFT,
    children: lines.flatMap((ln, idx) => {
      const runs: TextRun[] = [
        new TextRun({ text: ln, bold: opts.bold, italics: opts.italics, size: opts.size ?? 18 }),
      ];
      if (idx < lines.length - 1) runs.push(new TextRun({ break: 1 }));
      return runs;
    }),
  });
}

function headerCell(text: string) {
  return new TableCell({
    shading: { fill: INDIGO, type: "clear", color: "auto" } as any,
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text, bold: true, size: 20, color: "FFFFFF" })],
      }),
    ],
  });
}

/** Construit le contenu d'une cellule de cours. */
function courseCellChildren(s: any): Paragraph[] {
  const teacher = teacherName(s);
  const room = roomLabel(s);
  const ps: Paragraph[] = [];
  // ECUE.
  ps.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: s.ecue_libelle ?? "", bold: true, size: 18 })],
    })
  );
  // Enseignant.
  ps.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: teacher ? teacher : "Non affecté",
          bold: true,
          color: teacher ? "C00000" : "808080",
          size: 18,
        }),
      ],
    })
  );
  if (room)
    ps.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: room, bold: true, color: "1F4E79", size: 18 })],
      })
    );
  return ps;
}

/** Contenu d'une case pouvant contenir plusieurs ECUE (séparées par un trait). */
function groupCellChildren(slots: any[]): Paragraph[] {
  const out: Paragraph[] = [];
  slots.forEach((s, idx) => {
    if (idx > 0) {
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF", space: 1 } },
          children: [new TextRun({ text: "", size: 4 })],
        })
      );
    }
    out.push(...courseCellChildren(s));
  });
  return out;
}
function buildTable(slots: any[]): Table {
  const occ = buildOccupancy(slots);
  const headerRow = new TableRow({
    tableHeader: true,
    children: [headerCell("HORAIRES"), ...DAY_KEYS.map((d) => headerCell(JOURS[d]))],
  });

  const gb = { style: BorderStyle.SINGLE, size: 4, color: GRID_BORDER };
  const rows = displayedHours(slots).map((h) => {
    const cells: TableCell[] = [
      new TableCell({
        shading: { fill: INDIGO_LIGHT, type: "clear", color: "auto" } as any,
        children: [
          new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [
              new TextRun({
                text: `${String(h).padStart(2, "0")}H – ${String(h + 1).padStart(2, "0")}H`,
                bold: true,
                size: 18,
                color: INDIGO_DARK,
              }),
            ],
          }),
        ],
      }),
    ];
    for (let d = 1; d <= 6; d++) {
      const cell = occ[d][h];
      if (cell?.kind === "start") {
        const first = cell.slots[0];
        const color = ueColor(first.ue_code || first.ue_libelle || first.ecue_id || "");
        cells.push(
          new TableCell({
            verticalMerge: VerticalMerge.RESTART,
            shading: { fill: color.bg, type: "clear", color: "auto" } as any,
            borders: {
              top: gb,
              bottom: gb,
              right: gb,
              left: { style: BorderStyle.SINGLE, size: 24, color: color.border },
            } as any,
            children: groupCellChildren(cell.slots),
          })
        );
      } else if (cell?.kind === "cont") {
        cells.push(new TableCell({ verticalMerge: VerticalMerge.CONTINUE, children: [new Paragraph("")] }));
      } else {
        cells.push(
          new TableCell({
            shading: { fill: "FFFFFF", type: "clear", color: "auto" } as any,
            children: [new Paragraph("")],
          })
        );
      }
    }
    return new TableRow({ children: cells });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: gb,
      bottom: gb,
      left: gb,
      right: gb,
      insideHorizontal: gb,
      insideVertical: gb,
    },
    rows: [headerRow, ...rows],
  });
}

/** Table d'en-tête (2 colonnes, sans bordures) pour gauche/droite. */
function twoCol(left: Paragraph[], right: Paragraph[]): Table {
  const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: noBorder,
      bottom: noBorder,
      left: noBorder,
      right: noBorder,
      insideHorizontal: noBorder,
      insideVertical: noBorder,
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: allNone(), children: left }),
          new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: allNone(), children: right }),
        ],
      }),
    ],
  });
}

function allNone() {
  const n = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return { top: n, bottom: n, left: n, right: n };
}

export async function downloadEmploiTempsDocx(data: any): Promise<void> {
  // Titres, période et année : calculés par le modèle partagé avec le PDF.
  const { slots, titreFiliere, periode, annee } = enTeteEmploiTemps(data);

  // Logo IPAM (optionnel) — chargé depuis /public.
  let logoParagraph: Paragraph | null = null;
  try {
    const res = await fetch("/logo-ipam.jpeg");
    if (res.ok) {
      const buf = await res.arrayBuffer();
      logoParagraph = new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 40 },
        children: [
          new ImageRun({
            type: "jpg",
            data: new Uint8Array(buf),
            transformation: { width: 80, height: 80 },
          } as any),
        ],
      });
    }
  } catch {
    // Logo optionnel : on génère le document même sans logo.
  }

  const doc = new Document({
    sections: [
      {
        properties: { page: { size: { orientation: "landscape" as any } } },
        children: [
          twoCol(
            [multiline(MINISTERE, { bold: true, size: 16 })],
            [multiline(REPUBLIQUE, { bold: true, size: 16, alignment: AlignmentType.RIGHT })]
          ),
          ...(logoParagraph ? [logoParagraph] : []),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 60 },
            children: [new TextRun({ text: INSTITUT, bold: true, italics: true, size: 18 })],
          }),
          twoCol(
            [
              new Paragraph({
                children: [
                  new TextRun({ text: "ANNÉE ACADÉMIQUE ", italics: true, size: 16 }),
                  new TextRun({ text: annee, bold: true, italics: true, size: 16 }),
                ],
              }),
            ],
            [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: "MESRS : Diplômes homologués", bold: true, italics: true, size: 16 })],
              }),
            ]
          ),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 160, after: 40 },
            children: [new TextRun({ text: "EMPLOI DU TEMPS : Modèle : HYBRIDE", bold: true, size: 28 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 40 },
            children: [
              new TextRun({ text: `${data?.libelle ?? "Semestre"} : `, bold: true, color: "C00000", size: 20 }),
              new TextRun({ text: periode, bold: true, size: 20 }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: titreFiliere, bold: true, size: 32 })],
          }),
          buildTable(slots),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const safe = (titreFiliere || "emploi-du-temps").replace(/[^\w-]+/g, "_");
  saveAs(blob, `Emploi_du_temps_${safe}.docx`);
}
