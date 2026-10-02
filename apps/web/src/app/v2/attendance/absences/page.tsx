import { requirePermission } from "@/platform/auth/server";
import { AbsencesScreen } from "../_components/AbsencesScreen";

export default async function AbsencesPage() {
  await requirePermission("attendance.report.read");
  return <AbsencesScreen />;
}
