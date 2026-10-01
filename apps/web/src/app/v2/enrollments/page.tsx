import { requirePermission } from "@/platform/auth/server";
import { EnrollmentsScreen } from "./_components/EnrollmentsScreen";

export default async function EnrollmentsPage() {
  await requirePermission("enrollment.read");
  return <EnrollmentsScreen />;
}
