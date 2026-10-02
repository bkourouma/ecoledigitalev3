import { requirePermission } from "@/platform/auth/server";
import { SessionsScreen } from "../_components/SessionsScreen";

export default async function SessionsPage() {
  await requirePermission("attendance.read");
  return <SessionsScreen />;
}
