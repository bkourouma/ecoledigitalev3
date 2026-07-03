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

const JOURS = ["", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI"];
const DAY_KEYS = [1, 2, 3, 4, 5, 6];

// Couleurs alignées sur la grille de l'interface (consultation).
const INDIGO = "4F46E5"; // indigo-600 (en-têtes)
const INDIGO_LIGHT = "EEF2FF"; // indigo-50 (colonne HORAIRES)
const INDIGO_DARK = "312E81"; // indigo-900 (texte HORAIRES)
const GRID_BORDER = "D1D5DB"; // gray-300

// Palette de fond par UE (identique au composant EmploiTempsGrid).
const UE_PALETTE = [
  { bg: "E0E7FF", border: "A5B4FC" },
  { bg: "DCFCE7", border: "86EFAC" },
  { bg: "FEF9C3", border: "FDE047" },
  { bg: "FCE7F3", border: "F9A8D4" },
  { bg: "E0F2FE", border: "7DD3FC" },
  { bg: "F3E8FF", border: "D8B4FE" },
  { bg: "FFEDD5", border: "FDBA74" },
  { bg: "CCFBF1", border: "5EEAD4" },
  { bg: "FEE2E2", border: "FCA5A5" },
  { bg: "E2E8F0", border: "CBD5E1" },
];
function ueColor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return UE_PALETTE[h % UE_PALETTE.length];
}

const MINISTERE =
  "Ministère de l'enseignement supérieur et\nde la recherche scientifique";
const REPUBLIQUE = "République de Côte d'Ivoire\nUnion – Discipline - Travail";
const INSTITUT = "INSTITUT POLYVALENT DES AFFAIRES ET DU MANAGEMENT";

function hourOf(t?: string | null): number | null {
  if (!t) return null;
  const h = parseInt(String(t).slice(0, 2), 10);
  return Number.isFinite(h) ? h : null;
}

function teacherName(s: any): string {
  const n = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
  return n;
}

function roomLabel(s: any): string {
  return s.classroom_name || s.classroom_code || "";
}

function fmtDateFr(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const s = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function academicYear(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

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

/** Grille : pour chaque jour, occupation horaire — plusieurs ECUE par case possibles. */
function buildOccupancy(slots: any[]) {
  // Regroupe par (jour, heure de début).
  const starts: Record<number, Record<number, any[]>> = {};
  for (let d = 1; d <= 6; d++) starts[d] = {};
  for (const s of slots) {
    const d = Number(s.jour);
    if (d < 1 || d > 6) continue;
    const start = hourOf(s.heure_debut);
    let end = hourOf(s.heure_fin);
    if (start == null || end == null) continue;
    if (end <= start) end = start + 1;
    (starts[d][start] ??= []).push({ ...s, _end: end });
  }
  // jour -> Map<hour, {kind:'start'|'cont', slots, span}>
  const byDay: Record<number, Record<number, any>> = {};
  for (let d = 1; d <= 6; d++) byDay[d] = {};
  for (let d = 1; d <= 6; d++) {
    for (const startStr of Object.keys(starts[d])) {
      const start = Number(startStr);
      const group = starts[d][start];
      const maxEnd = Math.max(...group.map((g) => g._end));
      byDay[d][start] = { kind: "start", slots: group, span: Math.max(1, maxEnd - start) };
      for (let h = start + 1; h < maxEnd; h++) if (!byDay[d][h]) byDay[d][h] = { kind: "cont" };
    }
  }
  return byDay;
}

/**
 * Plage horaire affichée : par défaut 08H → 18H (dernière ligne 17H–18H).
 * On étend la plage (avant 08H ou après 18H) seulement si un créneau dépasse.
 */
function displayedHours(slots: any[]): number[] {
  let minStart = 8;
  let maxEnd = 18;
  for (const s of slots) {
    const st = hourOf(s.heure_debut);
    let en = hourOf(s.heure_fin);
    if (st == null || en == null) continue;
    if (en <= st) en = st + 1;
    if (st < minStart) minStart = st;
    if (en > maxEnd) maxEnd = en;
  }
  const hours: number[] = [];
  for (let h = minStart; h < maxEnd; h++) hours.push(h);
  return hours;
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
  const slots: any[] = data?.slots ?? [];
  const titreFiliere = `${data?.filiere_nom ?? ""}`.trim();
  // Période : min/max des dates des créneaux, sinon période du semestre.
  const debuts = slots.map((s) => s.date_debut).filter(Boolean).sort();
  const fins = slots.map((s) => s.date_fin).filter(Boolean).sort();
  const dDebut = debuts[0] ?? data?.date_debut;
  const dFin = fins[fins.length - 1] ?? data?.date_fin;
  const periode = `Du ${fmtDateFr(dDebut)} au ${fmtDateFr(dFin)}`;
  const annee = academicYear(dDebut);

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
