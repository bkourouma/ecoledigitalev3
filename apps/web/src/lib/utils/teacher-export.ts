import { saveAs } from 'file-saver';
import { Teacher } from '@ecoledigitale/contracts';

export interface TeacherExportData {
  teachers: Teacher[];
  exportDate: string;
  totalCount: number;
}

/* -------------------------------------------------------------------------- */
/* Charte graphique du classeur (reprend l'orange/ambre de la page Enseignants) */
/* -------------------------------------------------------------------------- */

const BRAND = 'FFEA580C';        // orange-600 : bandeau de titre
const BRAND_DARK = 'FFC2410C';   // orange-700 : ligne d'en-tête du tableau
const BRAND_SOFT = 'FFFFF1E3';   // orange-50  : sous-titre et titres de section
const BAND = 'FFFFF8F1';         // teinte des lignes paires (effet zébré)
const BORDER = 'FFF0DCC8';       // filets discrets, ton chaud
const INK = 'FF3F3F46';          // texte courant
const INK_SOFT = 'FF9A3412';     // texte secondaire (mentions, totaux)

const STATUS_STYLE: Record<string, { label: string; font: string; fill: string }> = {
  active: { label: 'Actif', font: 'FF15803D', fill: 'FFDCFCE7' },
  inactive: { label: 'Inactif', font: 'FF52525B', fill: 'FFF4F4F5' },
  suspended: { label: 'Suspendu', font: 'FFB91C1C', fill: 'FFFEE2E2' },
};

const CONTRACT_LABELS: Record<string, string> = {
  permanent: 'Permanent (CDI)',
  temporary: 'Temporaire (CDD)',
  freelance: 'Vacataire',
};

const contractLabel = (value: string) => CONTRACT_LABELS[value] ?? value;
const statusLabel = (value: string) => STATUS_STYLE[value]?.label ?? value;

/** Colonnes du tableau principal, dans l'ordre d'affichage. */
const COLUMNS: Array<{
  header: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  value: (teacher: Teacher, index: number) => string | number | null;
}> = [
  { header: 'N°', width: 6, align: 'center', value: (_t, i) => i + 1 },
  { header: 'Matricule', width: 16, align: 'center', value: (t) => t.employeeNumber || '—' },
  { header: 'Nom', width: 20, value: (t) => t.lastName },
  { header: 'Prénom(s)', width: 22, value: (t) => t.firstName },
  { header: 'Email', width: 34, value: (t) => t.email || '—' },
  { header: 'Téléphone', width: 18, align: 'center', value: (t) => t.phone || '—' },
  { header: 'Spécialités', width: 30, value: (t) => t.specialties?.join(', ') || '—' },
  { header: 'Qualifications', width: 30, value: (t) => t.qualifications?.join(', ') || '—' },
  { header: 'Type de contrat', width: 18, align: 'center', value: (t) => contractLabel(t.contractType) },
  { header: 'Statut', width: 14, align: 'center', value: (t) => statusLabel(t.status) },
  {
    header: "Date d'embauche",
    width: 16,
    align: 'center',
    value: (t) => (t.hireDate ? new Date(t.hireDate).toLocaleDateString('fr-FR') : '—'),
  },
  {
    header: 'Taux horaire',
    width: 16,
    align: 'right',
    // `null` plutôt que '—' : la cellule reste numérique pour les totaux Excel.
    value: (t) => (typeof t.hourlyRate === 'number' ? t.hourlyRate : null),
  },
];

const LAST_COL = COLUMNS.length;
const HEADER_ROW = 4; // lignes 1-3 : bandeau de titre, sous-titre, respiration

/** Filet fin uniforme appliqué aux cellules du tableau. */
const thinBorder = {
  top: { style: 'thin' as const, color: { argb: BORDER } },
  left: { style: 'thin' as const, color: { argb: BORDER } },
  bottom: { style: 'thin' as const, color: { argb: BORDER } },
  right: { style: 'thin' as const, color: { argb: BORDER } },
};

const solidFill = (argb: string) => ({
  type: 'pattern' as const,
  pattern: 'solid' as const,
  fgColor: { argb },
});

/**
 * ExcelJS n'est chargé qu'au clic sur « Excel » : la librairie pèse plusieurs
 * centaines de Ko et n'a aucune raison d'entrer dans le bundle initial.
 */
const loadExcelJS = async () => {
  const mod: any = await import('exceljs');
  return mod.default ?? mod;
};

/** Bandeau de titre + sous-titre commun aux deux onglets. */
const drawBanner = (sheet: any, lastCol: number, title: string, subtitle: string) => {
  sheet.mergeCells(1, 1, 1, lastCol);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = solidFill(BRAND);
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 40;

  sheet.mergeCells(2, 1, 2, lastCol);
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value = subtitle;
  subtitleCell.font = { name: 'Calibri', size: 11, italic: true, color: { argb: INK_SOFT } };
  subtitleCell.fill = solidFill(BRAND_SOFT);
  subtitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(2).height = 22;

  sheet.getRow(3).height = 8; // respiration entre le bandeau et le contenu
};

/* -------------------------------------------------------------------------- */
/* Onglet « Enseignants »                                                      */
/* -------------------------------------------------------------------------- */

const buildTeachersSheet = (workbook: any, data: TeacherExportData) => {
  const sheet = workbook.addWorksheet('Enseignants', {
    views: [{ state: 'frozen', ySplit: HEADER_ROW, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  sheet.columns = COLUMNS.map((col) => ({ width: col.width }));

  drawBanner(
    sheet,
    LAST_COL,
    'ENSEIGNANTS & VACATAIRES',
    `Liste arrêtée au ${data.exportDate} · ${data.totalCount} ${data.totalCount > 1 ? 'enseignants' : 'enseignant'}`
  );

  // En-tête du tableau
  const header = sheet.getRow(HEADER_ROW);
  header.height = 28;
  COLUMNS.forEach((col, i) => {
    const cell = header.getCell(i + 1);
    cell.value = col.header;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solidFill(BRAND_DARK);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder;
  });

  // Lignes de données
  data.teachers.forEach((teacher, index) => {
    const row = sheet.getRow(HEADER_ROW + 1 + index);
    row.height = 20;

    COLUMNS.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      cell.value = col.value(teacher, index);
      cell.font = { name: 'Calibri', size: 10, color: { argb: INK } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: col.align ?? 'left',
        wrapText: col.width >= 30,
      };
      cell.border = thinBorder;
      if (index % 2 === 1) cell.fill = solidFill(BAND);
    });

    // Le statut est mis en évidence comme un badge (couleur = état).
    const statusCell = row.getCell(COLUMNS.findIndex((c) => c.header === 'Statut') + 1);
    const style = STATUS_STYLE[teacher.status];
    if (style) {
      statusCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: style.font } };
      statusCell.fill = solidFill(style.fill);
    }

    const rateCell = row.getCell(LAST_COL);
    rateCell.numFmt = '#,##0 "XOF"';
  });

  const lastDataRow = HEADER_ROW + data.teachers.length;

  if (data.teachers.length > 0) {
    sheet.autoFilter = {
      from: { row: HEADER_ROW, column: 1 },
      to: { row: lastDataRow, column: LAST_COL },
    };

    // Ligne de total : rappel de l'effectif + masse horaire tarifée.
    const totalRow = sheet.getRow(lastDataRow + 1);
    totalRow.height = 24;
    sheet.mergeCells(lastDataRow + 1, 1, lastDataRow + 1, LAST_COL - 1);
    const totalLabel = sheet.getCell(lastDataRow + 1, 1);
    totalLabel.value = `Total : ${data.totalCount} ${data.totalCount > 1 ? 'enseignants' : 'enseignant'}`;
    totalLabel.font = { name: 'Calibri', size: 11, bold: true, color: { argb: INK_SOFT } };
    totalLabel.alignment = { vertical: 'middle', horizontal: 'right' };
    totalLabel.fill = solidFill(BRAND_SOFT);

    const totalRate = sheet.getCell(lastDataRow + 1, LAST_COL);
    const rateColLetter = sheet.getColumn(LAST_COL).letter;
    totalRate.value = { formula: `SUM(${rateColLetter}${HEADER_ROW + 1}:${rateColLetter}${lastDataRow})` };
    totalRate.numFmt = '#,##0 "XOF"';
    totalRate.font = { name: 'Calibri', size: 11, bold: true, color: { argb: INK_SOFT } };
    totalRate.alignment = { vertical: 'middle', horizontal: 'right' };
    totalRate.fill = solidFill(BRAND_SOFT);

    for (let col = 1; col <= LAST_COL; col += 1) {
      sheet.getCell(lastDataRow + 1, col).border = {
        ...thinBorder,
        top: { style: 'medium', color: { argb: BRAND_DARK } },
      };
    }
  }

  // Mention de bas de page
  const footerRow = lastDataRow + (data.teachers.length > 0 ? 3 : 2);
  sheet.mergeCells(footerRow, 1, footerRow, LAST_COL);
  const footer = sheet.getCell(footerRow, 1);
  footer.value = `Document généré automatiquement par ÉcoleDigitale le ${data.exportDate}`;
  footer.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FFA1A1AA' } };
  footer.alignment = { horizontal: 'center' };

  // À l'impression, l'en-tête se répète en haut de chaque page.
  sheet.pageSetup.printTitlesRow = `${HEADER_ROW}:${HEADER_ROW}`;
};

/* -------------------------------------------------------------------------- */
/* Onglet « Synthèse »                                                         */
/* -------------------------------------------------------------------------- */

const SUMMARY_LAST_COL = 3;

/** Écrit un bloc « titre de section + tableau + total » et renvoie la ligne suivante. */
const drawSummarySection = (
  sheet: any,
  startRow: number,
  title: string,
  rows: Array<{ label: string; count: number; color?: string }>,
  total: number
) => {
  sheet.mergeCells(startRow, 1, startRow, SUMMARY_LAST_COL);
  const sectionTitle = sheet.getCell(startRow, 1);
  sectionTitle.value = title;
  sectionTitle.font = { name: 'Calibri', size: 12, bold: true, color: { argb: BRAND_DARK } };
  sectionTitle.fill = solidFill(BRAND_SOFT);
  sectionTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(startRow).height = 24;

  const headerRow = sheet.getRow(startRow + 1);
  headerRow.height = 22;
  ['Catégorie', 'Effectif', 'Part'].forEach((label, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solidFill(BRAND_DARK);
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', indent: i === 0 ? 1 : 0 };
    cell.border = thinBorder;
  });

  rows.forEach((entry, index) => {
    const row = sheet.getRow(startRow + 2 + index);
    row.height = 20;

    const labelCell = row.getCell(1);
    labelCell.value = entry.label;
    labelCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: entry.color ?? INK } };
    labelCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    const countCell = row.getCell(2);
    countCell.value = entry.count;
    countCell.font = { name: 'Calibri', size: 10, color: { argb: INK } };
    countCell.alignment = { vertical: 'middle', horizontal: 'center' };

    const shareCell = row.getCell(3);
    shareCell.value = total > 0 ? entry.count / total : 0;
    shareCell.numFmt = '0.0%';
    shareCell.font = { name: 'Calibri', size: 10, color: { argb: INK } };
    shareCell.alignment = { vertical: 'middle', horizontal: 'center' };

    for (let col = 1; col <= SUMMARY_LAST_COL; col += 1) {
      const cell = row.getCell(col);
      cell.border = thinBorder;
      if (index % 2 === 1) cell.fill = solidFill(BAND);
    }
  });

  // Barres de données sur la colonne « Effectif » : la répartition se lit d'un coup d'œil.
  const firstDataRow = startRow + 2;
  const lastRow = startRow + 1 + rows.length;
  // `cfvo` et `gradient: true` sont requis par le writer ExcelJS : sans eux la
  // règle part sur la variante x14 et l'écriture du classeur échoue.
  sheet.addConditionalFormatting({
    ref: `B${firstDataRow}:B${lastRow}`,
    rules: [
      {
        type: 'dataBar',
        priority: 1,
        gradient: true,
        color: { argb: BRAND },
        cfvo: [{ type: 'min' }, { type: 'max' }],
      },
    ],
  });

  const totalRow = sheet.getRow(lastRow + 1);
  totalRow.height = 22;
  const totalLabel = totalRow.getCell(1);
  totalLabel.value = 'Total';
  totalLabel.font = { name: 'Calibri', size: 10, bold: true, color: { argb: INK_SOFT } };
  totalLabel.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  const totalCount = totalRow.getCell(2);
  totalCount.value = total;
  totalCount.font = { name: 'Calibri', size: 10, bold: true, color: { argb: INK_SOFT } };
  totalCount.alignment = { vertical: 'middle', horizontal: 'center' };
  const totalShare = totalRow.getCell(3);
  totalShare.value = total > 0 ? 1 : 0;
  totalShare.numFmt = '0.0%';
  totalShare.font = { name: 'Calibri', size: 10, bold: true, color: { argb: INK_SOFT } };
  totalShare.alignment = { vertical: 'middle', horizontal: 'center' };
  for (let col = 1; col <= SUMMARY_LAST_COL; col += 1) {
    const cell = totalRow.getCell(col);
    cell.fill = solidFill(BRAND_SOFT);
    cell.border = { ...thinBorder, top: { style: 'medium', color: { argb: BRAND_DARK } } };
  }

  return lastRow + 3; // une ligne vide entre deux sections
};

const buildSummarySheet = (workbook: any, data: TeacherExportData) => {
  const sheet = workbook.addWorksheet('Synthèse', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  sheet.columns = [{ width: 34 }, { width: 16 }, { width: 16 }];

  drawBanner(sheet, SUMMARY_LAST_COL, 'SYNTHÈSE DU CORPS ENSEIGNANT', `Situation au ${data.exportDate}`);

  const count = (predicate: (t: Teacher) => boolean) => data.teachers.filter(predicate).length;

  let row = drawSummarySection(
    sheet,
    HEADER_ROW,
    'RÉPARTITION PAR STATUT',
    [
      { label: 'Actifs', count: count((t) => t.status === 'active'), color: STATUS_STYLE.active.font },
      { label: 'Inactifs', count: count((t) => t.status === 'inactive'), color: STATUS_STYLE.inactive.font },
      { label: 'Suspendus', count: count((t) => t.status === 'suspended'), color: STATUS_STYLE.suspended.font },
    ],
    data.totalCount
  );

  row = drawSummarySection(
    sheet,
    row,
    'RÉPARTITION PAR TYPE DE CONTRAT',
    [
      { label: CONTRACT_LABELS.permanent, count: count((t) => t.contractType === 'permanent') },
      { label: CONTRACT_LABELS.temporary, count: count((t) => t.contractType === 'temporary') },
      { label: CONTRACT_LABELS.freelance, count: count((t) => t.contractType === 'freelance') },
    ],
    data.totalCount
  );

  sheet.mergeCells(row, 1, row, SUMMARY_LAST_COL);
  const footer = sheet.getCell(row, 1);
  footer.value = `Document généré automatiquement par ÉcoleDigitale le ${data.exportDate}`;
  footer.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FFA1A1AA' } };
  footer.alignment = { horizontal: 'center' };
};

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

export const exportTeachersToExcel = async (data: TeacherExportData) => {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();

  workbook.creator = 'ÉcoleDigitale';
  workbook.lastModifiedBy = 'ÉcoleDigitale';
  workbook.title = 'Liste des enseignants et vacataires';

  buildTeachersSheet(workbook, data);
  buildSummarySheet(workbook, data);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  saveAs(blob, `enseignants_${new Date().toISOString().split('T')[0]}.xlsx`);
};
