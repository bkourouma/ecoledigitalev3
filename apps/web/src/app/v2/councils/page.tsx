import { requirePermission } from "@/platform/auth/server";
import { CalendarScreen } from "./_components/CalendarScreen";

export default async function CouncilsCalendarPage() {
  await requirePermission("council.read");
  return <CalendarScreen />;
}
