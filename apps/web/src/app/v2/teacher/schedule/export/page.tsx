import { requirePermission } from "@/platform/auth/server";
import { ExportScreen } from "../../../schedule/_components/ExportScreen";

/** Export iCalendar de MON emploi du temps (téléchargement et jetons d'abonnement révocables). */
export default async function TeacherScheduleExportPage() {
  await requirePermission("schedule.own.read");
  return <ExportScreen />;
}
