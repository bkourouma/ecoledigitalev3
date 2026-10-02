import { requirePermission } from "@/platform/auth/server";
import { EnrollmentScreen } from "../_components/Enrollment";

export default async function DirectionEnrollmentPage() {
  await requirePermission("analytics.read");
  return <EnrollmentScreen />;
}
