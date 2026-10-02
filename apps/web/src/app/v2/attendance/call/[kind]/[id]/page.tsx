import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { isCivilDate, todayCivil } from "@/platform/v2/dates";
import { CallScreen } from "../../../_components/CallScreen";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/v2/attendance/call/occurrence/<id séance>` (appel d'une séance) ou
 * `/v2/attendance/call/daily/<id classe>?date=AAAA-MM-JJ` (appel journalier).
 */
export default async function CallPage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ date?: string }> }) {
  await requireAnyPermission("attendance.take", "attendance.manage");
  const { kind, id } = await params;
  const { date } = await searchParams;
  if ((kind !== "occurrence" && kind !== "daily") || !UUID.test(id)) notFound();
  const day = date && isCivilDate(date) ? date : todayCivil();
  return <CallScreen kind={kind} id={id} date={day} />;
}
