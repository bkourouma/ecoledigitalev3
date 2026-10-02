import { requirePermission } from "@/platform/auth/server";
import { JustificationsScreen } from "../_components/JustificationsScreen";

export default async function JustificationsPage() {
  await requirePermission("attendance.justification.read");
  return <JustificationsScreen />;
}
