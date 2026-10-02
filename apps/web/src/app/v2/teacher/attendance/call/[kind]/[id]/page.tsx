import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { isUuid } from "@/platform/portal/ids";
import { isCivilDate, todayCivil } from "@/platform/v2/dates";
import { TeacherCall } from "../../../../_components/TeacherAttendance";

/**
 * `/v2/teacher/attendance/call/occurrence/<id séance>` (appel d'une séance) ou
 * `/v2/teacher/attendance/call/daily/<id classe>?date=AAAA-MM-JJ` (appel journalier). Même écran que `/v2/attendance/call/*`,
 * dans le portail ; l'API vérifie que la séance / la classe est bien celle de l'enseignant.
 */
export default async function TeacherCallPage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ date?: string }> }) {
  await requireAnyPermission("attendance.take", "attendance.manage");
  const { kind, id } = await params;
  const { date } = await searchParams;
  if ((kind !== "occurrence" && kind !== "daily") || !isUuid(id)) notFound();
  const day = date && isCivilDate(date) ? date : todayCivil();
  return <TeacherCall kind={kind} id={id} date={day} />;
}
