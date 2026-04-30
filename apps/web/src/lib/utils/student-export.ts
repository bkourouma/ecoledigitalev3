import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { StudentWithUser, StudentStatus } from '@ecoledigitale/contracts';

export interface StudentExportData {
  students: StudentWithUser[];
  exportDate: string;
  totalCount: number;
}

// Helpers to normalize student names/emails across shapes
function getStudentFullName(s: StudentWithUser): string {
  const anyS: any = s as any;
  const u: any = (s as any).user ?? {};
  const first = anyS.firstName ?? u.firstName ?? anyS.first_name ?? u.first_name ?? '';
  const last = anyS.lastName ?? u.lastName ?? anyS.last_name ?? u.last_name ?? '';
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || u.name || anyS.name || anyS.email || u.email || '';
}

function getStudentEmail(s: StudentWithUser): string {
  const anyS: any = s as any;
  const u: any = (s as any).user ?? {};
  return u.email ?? anyS.email ?? '';
}

function getStudentNumber(s: StudentWithUser): string {
  const anyS: any = s as any;
  return anyS.studentNumber ?? anyS.matricule ?? '';
}

// Format student data for export
const formatStudentForExport = (s: StudentWithUser) => ({
  'Nom complet': getStudentFullName(s),
  'Email': getStudentEmail(s),
  'Téléphone': s.phone || '',
  'Matricule': getStudentNumber(s),
  "Statut": s.status === 'active' ? 'Actif' :
            s.status === 'graduated' ? 'Diplômé' :
            s.status === 'suspended' ? 'Suspendu' :
            s.status === 'dropped' ? 'Abandonné' : 'Transféré',
  "Année actuelle": s.currentYear ?? '',
  'Date de naissance': s.dateOfBirth ? new Date(s.dateOfBirth as any).toLocaleDateString('fr-FR') : '',
  'Lieu de naissance': s.placeOfBirth || '',
  'Nationalité': s.nationality || '',
  'Téléphone d\'urgence': s.emergencyPhone || '',
  'Adresse': s.address || '',
  'Créé le': s.createdAt ? new Date(s.createdAt as any).toLocaleDateString('fr-FR') : '',
});

export const exportStudentsToExcel = (data: StudentExportData) => {
  const formatted = data.students.map(formatStudentForExport);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(formatted);
  ws['!cols'] = [
    { wch: 25 }, // Nom complet
    { wch: 30 }, // Email
    { wch: 15 }, // Téléphone
    { wch: 18 }, // Matricule
    { wch: 12 }, // Statut
    { wch: 12 }, // Année actuelle
    { wch: 15 }, // Date de naissance
    { wch: 20 }, // Lieu de naissance
    { wch: 15 }, // Nationalité
    { wch: 18 }, // Tel urgence
    { wch: 32 }, // Adresse
    { wch: 14 }, // Créé le
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Étudiants');

  const summaryData = [
    ["Rapport d'export des étudiants", ''],
    ["Date d'export", data.exportDate],
    ["Nombre total d'étudiants", data.totalCount],
    ['', ''],
    ['Répartition par statut', ''],
    ['Actifs', data.students.filter(s => s.status === 'active').length],
    ['Diplômés', data.students.filter(s => s.status === 'graduated').length],
    ['Suspendus', data.students.filter(s => s.status === 'suspended').length],
    ['Abandons', data.students.filter(s => s.status === 'dropped').length],
    ['Transférés', data.students.filter(s => s.status === 'transfer').length],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  summaryWs['!cols'] = [{ wch: 30 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Résumé');

  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const fileName = `etudiants_${new Date().toISOString().split('T')[0]}.xlsx`;
  saveAs(blob, fileName);
};

export const exportStudentsToWord = (data: StudentExportData) => {
  const html = generateWordHTML(data);
  const blob = new Blob([html], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  const fileName = `etudiants_${new Date().toISOString().split('T')[0]}.doc`;
  saveAs(blob, fileName);
};

const generateWordHTML = (data: StudentExportData): string => {
  const active = data.students.filter(s => s.status === 'active').length;
  const graduated = data.students.filter(s => s.status === 'graduated').length;
  const suspended = data.students.filter(s => s.status === 'suspended').length;
  const dropped = data.students.filter(s => s.status === 'dropped').length;
  const transfer = data.students.filter(s => s.status === 'transfer').length;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Rapport des Étudiants</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .header { text-align: center; margin-bottom: 30px; }
    .summary { margin-bottom: 30px; }
    .summary table { border-collapse: collapse; width: 100%; }
    .summary th, .summary td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    .summary th { background-color: #f2f2f2; }
    .students-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    .students-table th, .students-table td { border: 1px solid #ddd; padding: 6px; font-size: 10px; }
    .students-table th { background-color: #f2f2f2; font-weight: bold; }
    .page-break { page-break-before: always; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Rapport des Étudiants</h1>
    <p>Date d'export: ${data.exportDate}</p>
    <p>Nombre total d'étudiants: ${data.totalCount}</p>
  </div>

  <div class="summary">
    <h2>Résumé</h2>
    <table>
      <tr><th>Répartition par statut</th><th>Nombre</th></tr>
      <tr><td>Actifs</td><td>${active}</td></tr>
      <tr><td>Diplômés</td><td>${graduated}</td></tr>
      <tr><td>Suspendus</td><td>${suspended}</td></tr>
      <tr><td>Abandons</td><td>${dropped}</td></tr>
      <tr><td>Transférés</td><td>${transfer}</td></tr>
    </table>
  </div>

  <div class="page-break">
    <h2>Liste détaillée des étudiants</h2>
    <table class="students-table">
      <thead>
        <tr>
          <th>Nom complet</th>
          <th>Email</th>
          <th>Matricule</th>
          <th>Statut</th>
          <th>Année</th>
          <th>Téléphone</th>
          <th>Date de naissance</th>
          <th>Lieu de naissance</th>
          <th>Nationalité</th>
          <th>Téléphone d'urgence</th>
          <th>Adresse</th>
          <th>Créé le</th>
        </tr>
      </thead>
      <tbody>
        ${data.students.map(s => `
        <tr>
          <td>${getStudentFullName(s)}</td>
          <td>${getStudentEmail(s)}</td>
          <td>${getStudentNumber(s)}</td>
          <td>${s.status}</td>
          <td>${s.currentYear ?? ''}</td>
          <td>${s.phone ?? ''}</td>
          <td>${s.dateOfBirth ? new Date(s.dateOfBirth as any).toLocaleDateString('fr-FR') : ''}</td>
          <td>${s.placeOfBirth ?? ''}</td>
          <td>${s.nationality ?? ''}</td>
          <td>${s.emergencyPhone ?? ''}</td>
          <td>${s.address ?? ''}</td>
          <td>${s.createdAt ? new Date(s.createdAt as any).toLocaleDateString('fr-FR') : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
</body>
</html>`;
};

