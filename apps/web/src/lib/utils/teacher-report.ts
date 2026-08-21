/**
 * Exports PDF et Word de la liste des enseignants — décrits comme un
 * `ReportSpec`, rendus par le moteur commun (`report-pdf.ts` / `report-docx.ts`).
 */
import { Teacher } from "@ecoledigitale/contracts";
import { COLUMNS } from "@/lib/utils/teacher-columns";
import {
  dateEdition,
  effectif,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";
import { downloadReportDocx } from "@/lib/utils/report-docx";

function spec(teachers: Teacher[]): ReportSpec {
  return {
    title: "Liste des enseignants et vacataires",
    filename: `liste-enseignants-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: `Effectif : ${effectif(teachers.length, "enseignant")}`,
    blocks: [
      {
        kind: "table",
        table: {
          columns: COLUMNS.map((c) => ({ header: c.header, width: c.width, align: c.align })),
          rows: teachers.map((t, i) => COLUMNS.map((c) => c.value(t, i))),
        },
      },
    ],
  };
}

/** Ouvre la liste des enseignants dans la visionneuse PDF du navigateur. */
export const openTeachersPdf = (teachers: Teacher[], win?: Window | null) =>
  openReportPdf(spec(teachers), win);

/** Télécharge la liste des enseignants au format Word. */
export const downloadTeachersDocx = (teachers: Teacher[]) => downloadReportDocx(spec(teachers));
