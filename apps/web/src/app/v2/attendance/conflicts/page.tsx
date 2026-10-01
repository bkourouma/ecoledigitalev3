import { requirePermission } from "@/platform/auth/server";
import { ConflictsScreen } from "../_components/ConflictsScreen";

export default async function ConflictsPage() {
  await requirePermission("attendance.manage");
  return <ConflictsScreen />;
}
