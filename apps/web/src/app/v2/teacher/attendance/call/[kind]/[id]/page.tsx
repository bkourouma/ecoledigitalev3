import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { isUuid } from "@/platform/portal/ids";
import { isCivilDate, todayCivil } from "@/platform/v2/dates";
import { parseHalfDay } from "@/app/v2/attendance/_components/call-utils";
import { TeacherCall } from "../../../../_components/TeacherAttendance";

/**
 * `/v2/teacher/attendance/call/occurrence/<id séance>` (appel d'une séance) ou
 * `/v2/teacher/attendance/call/daily/<id classe>?date=AAAA-MM-JJ[&part=MORNING|AFTERNOON]` (appel journalier, par demi-journée au primaire). Même écran que `/v2/attendance/call/*`,
 * dans le portail ; l'API vérifie que la séance / la classe est bien celle de l'enseignant.
 */
export default async function TeacherCallPage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ date?: string; part?: string }> }) {
  await requireAnyPermission("attendance.take", "attendance.manage");
  const { kind, id } = await params;
  const { date, part } = await searchParams;
  if ((kind !== "occurrence" && kind !== "daily") || !isUuid(id)) notFound();
  const day = date && isCivilDate(date) ? date : todayCivil();
  const dayPart = kind === "daily" ? parseHalfDay(part) : undefined;
  return <TeacherCall kind={kind} id={id} date={day} {...(dayPart ? { dayPart } : {})} />;
}
