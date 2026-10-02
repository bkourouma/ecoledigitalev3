import { requirePermission } from "@/platform/auth/server";
import { StudentReportCards } from "../_components/StudentScreens";

export default async function StudentReportCardsPage() {
  await requirePermission("reportcard.self.read");
  return <StudentReportCards />;
}
