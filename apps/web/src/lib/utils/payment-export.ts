import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

export interface Payment {
  id: string;
  teacher_name: string;
  teacher_email: string;
  period_name: string;
  payment_type: string;
  base_amount: string;
  overtime_amount: string;
  bonus_amount: string;
  deductions: string;
  total_amount: string;
  currency: string;
  status: 'calculated' | 'approved' | 'paid' | 'cancelled';
  calculated_at: string;
  approved_at?: string;
  paid_at?: string;
  // Enhanced course details for detailed breakdown
  courseDetails?: Array<{
    courseName: string;
    courseCode: string;
    hours: number;
    hourlyRate: number;
    amount: number;
  }>;
}

export interface PaymentExportData {
  payments: Payment[];
  exportDate: string;
  totalCount: number;
}

// Format payment data for export
const formatPaymentForExport = (payment: Payment) => ({
  'Enseignant': payment.teacher_name,
  'Email': payment.teacher_email,
  'Période': payment.period_name,
  'Type de paiement': payment.payment_type,
  'Montant de base (FCFA)': parseFloat(payment.base_amount).toLocaleString('fr-FR'),
  'Heures supplémentaires (FCFA)': parseFloat(payment.overtime_amount).toLocaleString('fr-FR'),
  'Bonus (FCFA)': parseFloat(payment.bonus_amount).toLocaleString('fr-FR'),
  'Déductions (FCFA)': parseFloat(payment.deductions).toLocaleString('fr-FR'),
  'Montant total (FCFA)': parseFloat(payment.total_amount).toLocaleString('fr-FR'),
  'Statut': payment.status === 'calculated' ? 'Calculé' :
           payment.status === 'approved' ? 'Approuvé' :
           payment.status === 'paid' ? 'Payé' : 'Annulé',
  'Date de calcul': new Date(payment.calculated_at).toLocaleDateString('fr-FR'),
  'Date d\'approbation': payment.approved_at ? new Date(payment.approved_at).toLocaleDateString('fr-FR') : '',
  'Date de paiement': payment.paid_at ? new Date(payment.paid_at).toLocaleDateString('fr-FR') : ''
});

// Export to Excel
export const exportPaymentsToExcel = (data: PaymentExportData) => {
  // Format payments data
  const formattedPayments = data.payments.map(formatPaymentForExport);

  // Create workbook
  const wb = XLSX.utils.book_new();

  // Create main payments sheet
  const ws = XLSX.utils.json_to_sheet(formattedPayments);

  // Set column widths
  const colWidths = [
    { wch: 25 }, // Enseignant
    { wch: 30 }, // Email
    { wch: 20 }, // Période
    { wch: 15 }, // Type de paiement
    { wch: 20 }, // Montant de base
    { wch: 25 }, // Heures supplémentaires
    { wch: 15 }, // Bonus
    { wch: 15 }, // Déductions
    { wch: 20 }, // Montant total
    { wch: 12 }, // Statut
    { wch: 15 }, // Date de calcul
    { wch: 18 }, // Date d'approbation
    { wch: 15 }  // Date de paiement
  ];
  ws['!cols'] = colWidths;

  // Add the worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Paiements');

  // Create summary sheet
  const totalAmount = data.payments.reduce((sum, p) => sum + parseFloat(p.total_amount), 0);
  const calculatedCount = data.payments.filter(p => p.status === 'calculated').length;
  const approvedCount = data.payments.filter(p => p.status === 'approved').length;
  const paidCount = data.payments.filter(p => p.status === 'paid').length;
  const cancelledCount = data.payments.filter(p => p.status === 'cancelled').length;

  const summaryData = [
    ['Rapport d\'export des paiements', ''],
    ['Date d\'export', data.exportDate],
    ['Nombre total de paiements', data.totalCount],
    ['Montant total (FCFA)', totalAmount.toLocaleString('fr-FR')],
    ['', ''],
    ['Répartition par statut', ''],
    ['Calculés', calculatedCount],
    ['Approuvés', approvedCount],
    ['Payés', paidCount],
    ['Annulés', cancelledCount],
    ['', ''],
    ['Répartition par type', ''],
    ['Salaire fixe', data.payments.filter(p => p.payment_type === 'salary').length],
    ['Heures', data.payments.filter(p => p.payment_type === 'hourly').length],
    ['Mixte', data.payments.filter(p => p.payment_type === 'mixed').length]
  ];

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  summaryWs['!cols'] = [{ wch: 30 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Résumé');

  // Generate Excel file
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  // Download file
  const fileName = `paiements_${new Date().toISOString().split('T')[0]}.xlsx`;
  saveAs(blob, fileName);
};

const textCell = (value: string, bold = false) =>
  new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text: value, bold })],
      }),
    ],
  });

// Export to Word (real DOCX format)
export const exportPaymentsToWord = (data: PaymentExportData) => {
  const totalAmount = data.payments.reduce((sum, p) => sum + parseFloat(p.total_amount || '0'), 0);

  const tableRows = [
    new TableRow({
      children: [
        textCell('Enseignant', true),
        textCell('Période', true),
        textCell('Type', true),
        textCell('Base', true),
        textCell('H. Sup.', true),
        textCell('Bonus', true),
        textCell('Déductions', true),
        textCell('Total', true),
        textCell('Statut', true),
      ],
    }),
    ...data.payments.map((p) =>
      new TableRow({
        children: [
          textCell(p.teacher_name || ''),
          textCell(p.period_name || ''),
          textCell(p.payment_type || ''),
          textCell(parseFloat(p.base_amount || '0').toLocaleString('fr-FR')),
          textCell(parseFloat(p.overtime_amount || '0').toLocaleString('fr-FR')),
          textCell(parseFloat(p.bonus_amount || '0').toLocaleString('fr-FR')),
          textCell(parseFloat(p.deductions || '0').toLocaleString('fr-FR')),
          textCell(parseFloat(p.total_amount || '0').toLocaleString('fr-FR')),
          textCell(p.status === 'calculated' ? 'Calculé' : p.status === 'approved' ? 'Approuvé' : p.status === 'paid' ? 'Payé' : 'Annulé'),
        ],
      })
    ),
  ];

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'Rapport des Paiements', bold: true, size: 32 })],
          }),
          new Paragraph({ text: `Date d'export: ${data.exportDate}` }),
          new Paragraph({ text: `Nombre total de paiements: ${data.totalCount}` }),
          new Paragraph({ text: `Montant total: ${totalAmount.toLocaleString('fr-FR')} FCFA` }),
          new Paragraph({ text: '' }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows,
          }),
        ],
      },
    ],
  });
  const fileName = `paiements_${new Date().toISOString().split('T')[0]}.docx`;
  void Packer.toBlob(doc).then((blob) => saveAs(blob, fileName));
};

// Generate HTML content for Word export
const generateWordHTML = (data: PaymentExportData): string => {
  const totalAmount = data.payments.reduce((sum, p) => sum + parseFloat(p.total_amount), 0);
  const calculatedCount = data.payments.filter(p => p.status === 'calculated').length;
  const approvedCount = data.payments.filter(p => p.status === 'approved').length;
  const paidCount = data.payments.filter(p => p.status === 'paid').length;
  const cancelledCount = data.payments.filter(p => p.status === 'cancelled').length;

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Rapport des Paiements</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .summary { margin-bottom: 30px; }
        .summary table { border-collapse: collapse; width: 100%; }
        .summary th, .summary td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        .summary th { background-color: #f2f2f2; }
        .payments-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .payments-table th, .payments-table td { border: 1px solid #ddd; padding: 6px; font-size: 9px; }
        .payments-table th { background-color: #f2f2f2; font-weight: bold; }
        .page-break { page-break-before: always; }
        .amount { text-align: right; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Rapport des Paiements</h1>
        <p>Date d'export: ${data.exportDate}</p>
        <p>Nombre total de paiements: ${data.totalCount}</p>
        <p>Montant total: ${totalAmount.toLocaleString('fr-FR')} FCFA</p>
    </div>

    <div class="summary">
        <h2>Résumé</h2>
        <table>
            <tr><th>Répartition par statut</th><th>Nombre</th></tr>
            <tr><td>Paiements calculés</td><td>${calculatedCount}</td></tr>
            <tr><td>Paiements approuvés</td><td>${approvedCount}</td></tr>
            <tr><td>Paiements effectués</td><td>${paidCount}</td></tr>
            <tr><td>Paiements annulés</td><td>${cancelledCount}</td></tr>
        </table>
    </div>

    <div class="page-break">
        <h2>Liste détaillée des paiements</h2>
        <table class="payments-table">
            <thead>
                <tr>
                    <th>Enseignant</th>
                    <th>Période</th>
                    <th>Type</th>
                    <th>Base (FCFA)</th>
                    <th>H. Sup. (FCFA)</th>
                    <th>Bonus (FCFA)</th>
                    <th>Déductions (FCFA)</th>
                    <th>Total (FCFA)</th>
                    <th>Statut</th>
                    <th>Date calcul</th>
                </tr>
            </thead>
            <tbody>
                ${data.payments.map(payment => `
                    <tr>
                        <td>${payment.teacher_name}</td>
                        <td>${payment.period_name}</td>
                        <td>${payment.payment_type}</td>
                        <td class="amount">${parseFloat(payment.base_amount).toLocaleString('fr-FR')}</td>
                        <td class="amount">${parseFloat(payment.overtime_amount).toLocaleString('fr-FR')}</td>
                        <td class="amount">${parseFloat(payment.bonus_amount).toLocaleString('fr-FR')}</td>
                        <td class="amount">${parseFloat(payment.deductions).toLocaleString('fr-FR')}</td>
                        <td class="amount"><strong>${parseFloat(payment.total_amount).toLocaleString('fr-FR')}</strong></td>
                        <td>${payment.status === 'calculated' ? 'Calculé' :
                             payment.status === 'approved' ? 'Approuvé' :
                             payment.status === 'paid' ? 'Payé' : 'Annulé'}</td>
                        <td>${new Date(payment.calculated_at).toLocaleDateString('fr-FR')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
</body>
</html>`;
};

// Export a payslip (bulletin de paie) for a single teacher to Word
export const exportTeacherPayslipToWord = (opts: {
  teacherName: string;
  teacherEmail: string;
  payments: Payment[];
  exportDate?: string;
  organisationName?: string;
}) => {
  const { teacherName, teacherEmail, payments } = opts;
  const exportDate = opts.exportDate || new Date().toLocaleDateString('fr-FR');
  const organisationName = opts.organisationName || 'Bulletin de paie - Enseignant';

  const sum = (selector: (p: Payment) => number) =>
    payments.reduce((acc, p) => acc + selector(p), 0);

  const totalBase = sum(p => parseFloat(p.base_amount || '0'));
  const totalOvertime = sum(p => parseFloat(p.overtime_amount || '0'));
  const totalBonus = sum(p => parseFloat(p.bonus_amount || '0'));
  const totalDeductions = sum(p => parseFloat(p.deductions || '0'));
  const totalNet = sum(p => parseFloat(p.total_amount || '0'));

  const periods = Array.from(new Set(payments.map(p => p.period_name).filter(Boolean)));

  const detailRows = [
    new TableRow({
      children: [
        textCell('Période', true),
        textCell('Type', true),
        textCell('Base', true),
        textCell('H. Sup.', true),
        textCell('Bonus', true),
        textCell('Déductions', true),
        textCell('Total', true),
        textCell('Statut', true),
        textCell('Date calcul', true),
      ],
    }),
    ...payments.map((p) =>
      new TableRow({
        children: [
          textCell(p.period_name || ''),
          textCell(p.payment_type || ''),
          textCell(parseFloat(p.base_amount || '0').toLocaleString('fr-FR')),
          textCell(parseFloat(p.overtime_amount || '0').toLocaleString('fr-FR')),
          textCell(parseFloat(p.bonus_amount || '0').toLocaleString('fr-FR')),
          textCell(parseFloat(p.deductions || '0').toLocaleString('fr-FR')),
          textCell(parseFloat(p.total_amount || '0').toLocaleString('fr-FR')),
          textCell(p.status === 'calculated' ? 'Calculé' : p.status === 'approved' ? 'Approuvé' : p.status === 'paid' ? 'Payé' : 'Annulé'),
          textCell(p.calculated_at ? new Date(p.calculated_at).toLocaleDateString('fr-FR') : ''),
        ],
      })
    ),
  ];

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: organisationName, bold: true, size: 32 })],
          }),
          new Paragraph({ alignment: AlignmentType.CENTER, text: `Généré le ${exportDate}` }),
          new Paragraph({ text: '' }),
          new Paragraph({ children: [new TextRun({ text: 'Enseignant: ', bold: true }), new TextRun(teacherName)] }),
          new Paragraph({ children: [new TextRun({ text: 'Email: ', bold: true }), new TextRun(teacherEmail)] }),
          new Paragraph({ children: [new TextRun({ text: 'Périodes concernées: ', bold: true }), new TextRun(periods.join(', '))] }),
          new Paragraph({ text: '' }),
          new Paragraph({ children: [new TextRun({ text: `Montant de base: ${totalBase.toLocaleString('fr-FR')} FCFA`, bold: true })] }),
          new Paragraph({ text: `Heures supplémentaires: ${totalOvertime.toLocaleString('fr-FR')} FCFA` }),
          new Paragraph({ text: `Bonus: ${totalBonus.toLocaleString('fr-FR')} FCFA` }),
          new Paragraph({ text: `Déductions: -${totalDeductions.toLocaleString('fr-FR')} FCFA` }),
          new Paragraph({ children: [new TextRun({ text: `Total net à payer: ${totalNet.toLocaleString('fr-FR')} FCFA`, bold: true })] }),
          new Paragraph({ text: '' }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: detailRows,
          }),
          new Paragraph({ text: '' }),
          new Paragraph({ text: 'Document généré automatiquement. Valide sans signature.' }),
        ],
      },
    ],
  });
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '');
  const fileName = `bulletin_paie_${slug(teacherName)}_${new Date().toISOString().slice(0, 10)}.docx`;
  void Packer.toBlob(doc).then((blob) => saveAs(blob, fileName));
};

