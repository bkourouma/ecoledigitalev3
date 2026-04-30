// Simple export utilities using browser APIs

export interface AttendanceExportData {
  sessionInfo: {
    className: string;
    courseName: string;
    teacherName: string;
    sessionDate: string;
    sessionTime: string;
    location?: string;
    notes?: string;
  };
  students: Array<{
    studentNumber: string;
    name: string;
    attendanceStatus: string;
    arrivalTime?: string;
    departureTime?: string;
    notes?: string;
  }>;
}

export const exportToPDF = (data: AttendanceExportData) => {
  // Create HTML content for PDF
  const htmlContent = generateHTMLReport(data);

  // Open in new window for printing/saving as PDF
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();

    // Trigger print dialog after content loads
    setTimeout(() => {
      printWindow.print();
    }, 500);
  }
};

export const exportToExcel = (data: AttendanceExportData) => {
  // Create Excel-compatible TSV (Tab-Separated Values) content
  const excelContent = generateExcelTSV(data);

  // Add BOM for proper UTF-8 encoding
  const BOM = '\uFEFF';
  const contentWithBOM = BOM + excelContent;

  // Create and download Excel file
  const blob = new Blob([contentWithBOM], {
    type: 'application/vnd.ms-excel;charset=utf-8;'
  });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `presence_${data.sessionInfo.className.replace(/\s+/g, '_')}_${data.sessionInfo.sessionDate}.xls`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportToCSV = (data: AttendanceExportData) => {
  // Create CSV content
  const csvContent = generateCSVReport(data);

  // Add BOM (Byte Order Mark) for proper UTF-8 encoding in Excel
  const BOM = '\uFEFF';
  const csvWithBOM = BOM + csvContent;

  // Create and download CSV file with proper encoding
  const blob = new Blob([csvWithBOM], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `presence_${data.sessionInfo.className.replace(/\s+/g, '_')}_${data.sessionInfo.sessionDate}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Helper functions
const getStatusLabel = (status: string): string => {
  switch (status) {
    case 'present': return 'Présent';
    case 'absent': return 'Absent';
    case 'late': return 'Retard';
    case 'excused': return 'Excusé';
    case 'medical_leave': return 'Congé médical';
    default: return status;
  }
};

const getAttendanceSummary = (students: AttendanceExportData['students']) => {
  const summary = {
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    medical: 0,
    total: students.length
  };
  
  students.forEach(student => {
    switch (student.attendanceStatus) {
      case 'present':
        summary.present++;
        break;
      case 'absent':
        summary.absent++;
        break;
      case 'late':
        summary.late++;
        break;
      case 'excused':
        summary.excused++;
        break;
      case 'medical_leave':
        summary.medical++;
        break;
    }
  });
  
  return summary;
};

// Generate HTML report for PDF printing
const generateHTMLReport = (data: AttendanceExportData): string => {
  const summary = getAttendanceSummary(data.students);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Feuille de Présence - ${data.sessionInfo.className}</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 20px;
          color: #333;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 2px solid #2980b9;
          padding-bottom: 20px;
        }
        .header h1 {
          color: #2980b9;
          margin: 0;
          font-size: 24px;
        }
        .session-info {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 30px;
          background: #f8f9fa;
          padding: 15px;
          border-radius: 5px;
        }
        .session-info div {
          margin: 5px 0;
        }
        .session-info strong {
          color: #2c3e50;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 30px;
        }
        th, td {
          border: 1px solid #ddd;
          padding: 8px;
          text-align: left;
        }
        th {
          background-color: #2980b9;
          color: white;
          font-weight: bold;
        }
        tr:nth-child(even) {
          background-color: #f2f2f2;
        }
        .status-present { background-color: #2ecc71; color: white; padding: 4px 8px; border-radius: 3px; }
        .status-absent { background-color: #e74c3c; color: white; padding: 4px 8px; border-radius: 3px; }
        .status-late { background-color: #f1c40f; color: black; padding: 4px 8px; border-radius: 3px; }
        .status-excused { background-color: #3498db; color: white; padding: 4px 8px; border-radius: 3px; }
        .summary {
          background: #ecf0f1;
          padding: 15px;
          border-radius: 5px;
          margin-top: 20px;
        }
        .summary h3 {
          margin-top: 0;
          color: #2c3e50;
        }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 10px;
        }
        .summary-item {
          text-align: center;
          padding: 10px;
          background: white;
          border-radius: 3px;
        }
        @media print {
          body { margin: 0; }
          .header { page-break-inside: avoid; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Feuille de Présence</h1>
      </div>

      <div class="session-info">
        <div><strong>Classe:</strong> ${data.sessionInfo.className}</div>
        <div><strong>Cours:</strong> ${data.sessionInfo.courseName}</div>
        <div><strong>Enseignant:</strong> ${data.sessionInfo.teacherName}</div>
        <div><strong>Date:</strong> ${data.sessionInfo.sessionDate}</div>
        <div><strong>Heure:</strong> ${data.sessionInfo.sessionTime}</div>
        ${data.sessionInfo.location ? `<div><strong>Lieu:</strong> ${data.sessionInfo.location}</div>` : ''}
      </div>

      <table>
        <thead>
          <tr>
            <th>Matricule</th>
            <th>Nom</th>
            <th>Statut</th>
            <th>Heure d'arrivée</th>
            <th>Heure de départ</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${data.students.map(student => `
            <tr>
              <td>${student.studentNumber}</td>
              <td>${student.name}</td>
              <td><span class="status-${student.attendanceStatus}">${getStatusLabel(student.attendanceStatus)}</span></td>
              <td>${student.arrivalTime || '-'}</td>
              <td>${student.departureTime || '-'}</td>
              <td>${student.notes || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="summary">
        <h3>Résumé de présence</h3>
        <div class="summary-grid">
          <div class="summary-item">
            <strong>Présents</strong><br>
            ${summary.present}
          </div>
          <div class="summary-item">
            <strong>Absents</strong><br>
            ${summary.absent}
          </div>
          <div class="summary-item">
            <strong>Retards</strong><br>
            ${summary.late}
          </div>
          <div class="summary-item">
            <strong>Excusés</strong><br>
            ${summary.excused}
          </div>
          <div class="summary-item">
            <strong>Total</strong><br>
            ${summary.total}
          </div>
        </div>
      </div>

      ${data.sessionInfo.notes ? `
        <div style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 5px;">
          <strong>Notes:</strong> ${data.sessionInfo.notes}
        </div>
      ` : ''}
    </body>
    </html>
  `;
};

// Generate CSV report with proper escaping
const generateCSVReport = (data: AttendanceExportData): string => {
  const summary = getAttendanceSummary(data.students);

  // Helper function to escape CSV values
  const escapeCSV = (value: string): string => {
    if (!value) return '';
    // If value contains comma, quote, or newline, wrap in quotes and escape internal quotes
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  let csv = '';

  // Session information
  csv += 'INFORMATIONS DE SESSION\n';
  csv += `Classe,${escapeCSV(data.sessionInfo.className)}\n`;
  csv += `Cours,${escapeCSV(data.sessionInfo.courseName)}\n`;
  csv += `Enseignant,${escapeCSV(data.sessionInfo.teacherName)}\n`;
  csv += `Date,${escapeCSV(data.sessionInfo.sessionDate)}\n`;
  csv += `Heure,${escapeCSV(data.sessionInfo.sessionTime)}\n`;
  if (data.sessionInfo.location) {
    csv += `Lieu,${escapeCSV(data.sessionInfo.location)}\n`;
  }
  csv += '\n';

  // Headers
  csv += 'Matricule,Nom,Statut,Heure d\'arrivée,Heure de départ,Notes\n';

  // Student data
  data.students.forEach(student => {
    const row = [
      escapeCSV(student.studentNumber),
      escapeCSV(student.name),
      escapeCSV(getStatusLabel(student.attendanceStatus)),
      escapeCSV(student.arrivalTime || ''),
      escapeCSV(student.departureTime || ''),
      escapeCSV(student.notes || '')
    ];
    csv += row.join(',') + '\n';
  });

  // Summary
  csv += '\n';
  csv += 'RÉSUMÉ\n';
  csv += `Présents,${summary.present}\n`;
  csv += `Absents,${summary.absent}\n`;
  csv += `Retards,${summary.late}\n`;
  csv += `Excusés,${summary.excused}\n`;
  csv += `Total,${summary.total}\n`;

  if (data.sessionInfo.notes) {
    csv += '\n';
    csv += `Notes,${escapeCSV(data.sessionInfo.notes)}\n`;
  }

  return csv;
};

// Generate Excel-compatible TSV (Tab-Separated Values) format
const generateExcelTSV = (data: AttendanceExportData): string => {
  const summary = getAttendanceSummary(data.students);

  // Helper function to escape TSV values
  const escapeTSV = (value: string): string => {
    if (!value) return '';
    // Replace tabs with spaces and handle newlines
    return value.replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, '');
  };

  let tsv = '';

  // Title
  tsv += 'Feuille de Présence\t\t\t\t\t\n';
  tsv += '\t\t\t\t\t\n'; // Empty row

  // Session information
  tsv += 'INFORMATIONS DE SESSION\t\t\t\t\t\n';
  tsv += `Classe\t${escapeTSV(data.sessionInfo.className)}\t\t\t\t\n`;
  tsv += `Cours\t${escapeTSV(data.sessionInfo.courseName)}\t\t\t\t\n`;
  tsv += `Enseignant\t${escapeTSV(data.sessionInfo.teacherName)}\t\t\t\t\n`;
  tsv += `Date\t${escapeTSV(data.sessionInfo.sessionDate)}\t\t\t\t\n`;
  tsv += `Heure\t${escapeTSV(data.sessionInfo.sessionTime)}\t\t\t\t\n`;
  if (data.sessionInfo.location) {
    tsv += `Lieu\t${escapeTSV(data.sessionInfo.location)}\t\t\t\t\n`;
  }
  tsv += '\t\t\t\t\t\n'; // Empty row

  // Headers
  tsv += 'Matricule\tNom\tStatut\tHeure d\'arrivée\tHeure de départ\tNotes\n';

  // Student data
  data.students.forEach(student => {
    tsv += `${escapeTSV(student.studentNumber)}\t${escapeTSV(student.name)}\t${escapeTSV(getStatusLabel(student.attendanceStatus))}\t${escapeTSV(student.arrivalTime || '')}\t${escapeTSV(student.departureTime || '')}\t${escapeTSV(student.notes || '')}\n`;
  });

  // Empty row
  tsv += '\t\t\t\t\t\n';

  // Summary
  tsv += 'RÉSUMÉ\t\t\t\t\t\n';
  tsv += `Présents\t${summary.present}\t\t\t\t\n`;
  tsv += `Absents\t${summary.absent}\t\t\t\t\n`;
  tsv += `Retards\t${summary.late}\t\t\t\t\n`;
  tsv += `Excusés\t${summary.excused}\t\t\t\t\n`;
  tsv += `Total\t${summary.total}\t\t\t\t\n`;

  if (data.sessionInfo.notes) {
    tsv += '\t\t\t\t\t\n';
    tsv += `Notes\t${escapeTSV(data.sessionInfo.notes)}\t\t\t\t\n`;
  }

  return tsv;
};
