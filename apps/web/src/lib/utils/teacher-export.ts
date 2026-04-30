import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { Teacher } from '@ecoledigitale/contracts';

export interface TeacherExportData {
  teachers: Teacher[];
  exportDate: string;
  totalCount: number;
}

// Format teacher data for export
const formatTeacherForExport = (teacher: Teacher) => ({
  'Nom complet': `${teacher.firstName} ${teacher.lastName}`,
  'Email': teacher.email,
  'Téléphone': teacher.phone || '',
  'Spécialité': teacher.specialty || '',
  'Type de contrat': teacher.contractType === 'permanent' ? 'Permanent' : 
                   teacher.contractType === 'temporary' ? 'Temporaire' : 'Vacataire',
  'Statut': teacher.status === 'active' ? 'Actif' : 
           teacher.status === 'inactive' ? 'Inactif' : 'Suspendu',
  'Date d\'embauche': teacher.hireDate ? new Date(teacher.hireDate).toLocaleDateString('fr-FR') : '',
  'Adresse': teacher.address || '',
  'Date de naissance': teacher.dateOfBirth ? new Date(teacher.dateOfBirth).toLocaleDateString('fr-FR') : '',
  'Lieu de naissance': teacher.placeOfBirth || '',
  'Nationalité': teacher.nationality || '',
  'Numéro CNI': teacher.idNumber || '',
  'Diplômes': teacher.qualifications || '',
  'Expérience': teacher.experience || '',
  'Notes': teacher.notes || ''
});

// Export to Excel
export const exportTeachersToExcel = (data: TeacherExportData) => {
  // Format teachers data
  const formattedTeachers = data.teachers.map(formatTeacherForExport);
  
  // Create workbook
  const wb = XLSX.utils.book_new();
  
  // Create main teachers sheet
  const ws = XLSX.utils.json_to_sheet(formattedTeachers);
  
  // Set column widths
  const colWidths = [
    { wch: 25 }, // Nom complet
    { wch: 30 }, // Email
    { wch: 15 }, // Téléphone
    { wch: 20 }, // Spécialité
    { wch: 15 }, // Type de contrat
    { wch: 10 }, // Statut
    { wch: 15 }, // Date d'embauche
    { wch: 30 }, // Adresse
    { wch: 15 }, // Date de naissance
    { wch: 20 }, // Lieu de naissance
    { wch: 15 }, // Nationalité
    { wch: 15 }, // Numéro CNI
    { wch: 30 }, // Diplômes
    { wch: 30 }, // Expérience
    { wch: 30 }  // Notes
  ];
  ws['!cols'] = colWidths;
  
  // Add the worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Enseignants');
  
  // Create summary sheet
  const summaryData = [
    ['Rapport d\'export des enseignants', ''],
    ['Date d\'export', data.exportDate],
    ['Nombre total d\'enseignants', data.totalCount],
    ['', ''],
    ['Répartition par statut', ''],
    ['Actifs', data.teachers.filter(t => t.status === 'active').length],
    ['Inactifs', data.teachers.filter(t => t.status === 'inactive').length],
    ['Suspendus', data.teachers.filter(t => t.status === 'suspended').length],
    ['', ''],
    ['Répartition par type de contrat', ''],
    ['Permanents', data.teachers.filter(t => t.contractType === 'permanent').length],
    ['Temporaires', data.teachers.filter(t => t.contractType === 'temporary').length],
    ['Vacataires', data.teachers.filter(t => t.contractType === 'freelance').length]
  ];
  
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  summaryWs['!cols'] = [{ wch: 30 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Résumé');
  
  // Generate Excel file
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  
  // Download file
  const fileName = `enseignants_${new Date().toISOString().split('T')[0]}.xlsx`;
  saveAs(blob, fileName);
};

// Export to Word (HTML format that Word can open)
export const exportTeachersToWord = (data: TeacherExportData) => {
  const htmlContent = generateWordHTML(data);
  
  // Create blob with HTML content
  const blob = new Blob([htmlContent], { 
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
  });
  
  // Download file
  const fileName = `enseignants_${new Date().toISOString().split('T')[0]}.doc`;
  saveAs(blob, fileName);
};

// Generate HTML content for Word export
const generateWordHTML = (data: TeacherExportData): string => {
  const activeTeachers = data.teachers.filter(t => t.status === 'active').length;
  const inactiveTeachers = data.teachers.filter(t => t.status === 'inactive').length;
  const suspendedTeachers = data.teachers.filter(t => t.status === 'suspended').length;
  
  const permanentTeachers = data.teachers.filter(t => t.contractType === 'permanent').length;
  const temporaryTeachers = data.teachers.filter(t => t.contractType === 'temporary').length;
  const freelanceTeachers = data.teachers.filter(t => t.contractType === 'freelance').length;

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Rapport des Enseignants</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .summary { margin-bottom: 30px; }
        .summary table { border-collapse: collapse; width: 100%; }
        .summary th, .summary td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        .summary th { background-color: #f2f2f2; }
        .teachers-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .teachers-table th, .teachers-table td { border: 1px solid #ddd; padding: 6px; font-size: 10px; }
        .teachers-table th { background-color: #f2f2f2; font-weight: bold; }
        .page-break { page-break-before: always; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Rapport des Enseignants</h1>
        <p>Date d'export: ${data.exportDate}</p>
        <p>Nombre total d'enseignants: ${data.totalCount}</p>
    </div>
    
    <div class="summary">
        <h2>Résumé</h2>
        <table>
            <tr><th>Répartition par statut</th><th>Nombre</th></tr>
            <tr><td>Enseignants actifs</td><td>${activeTeachers}</td></tr>
            <tr><td>Enseignants inactifs</td><td>${inactiveTeachers}</td></tr>
            <tr><td>Enseignants suspendus</td><td>${suspendedTeachers}</td></tr>
        </table>
        
        <table style="margin-top: 20px;">
            <tr><th>Répartition par type de contrat</th><th>Nombre</th></tr>
            <tr><td>Permanents</td><td>${permanentTeachers}</td></tr>
            <tr><td>Temporaires</td><td>${temporaryTeachers}</td></tr>
            <tr><td>Vacataires</td><td>${freelanceTeachers}</td></tr>
        </table>
    </div>
    
    <div class="page-break">
        <h2>Liste détaillée des enseignants</h2>
        <table class="teachers-table">
            <thead>
                <tr>
                    <th>Nom complet</th>
                    <th>Email</th>
                    <th>Téléphone</th>
                    <th>Spécialité</th>
                    <th>Type de contrat</th>
                    <th>Statut</th>
                    <th>Date d'embauche</th>
                    <th>Adresse</th>
                </tr>
            </thead>
            <tbody>
                ${data.teachers.map(teacher => `
                    <tr>
                        <td>${teacher.firstName} ${teacher.lastName}</td>
                        <td>${teacher.email}</td>
                        <td>${teacher.phone || ''}</td>
                        <td>${teacher.specialty || ''}</td>
                        <td>${teacher.contractType === 'permanent' ? 'Permanent' : 
                             teacher.contractType === 'temporary' ? 'Temporaire' : 'Vacataire'}</td>
                        <td>${teacher.status === 'active' ? 'Actif' : 
                             teacher.status === 'inactive' ? 'Inactif' : 'Suspendu'}</td>
                        <td>${teacher.hireDate ? new Date(teacher.hireDate).toLocaleDateString('fr-FR') : ''}</td>
                        <td>${teacher.address || ''}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
</body>
</html>`;
};
