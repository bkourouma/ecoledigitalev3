import { requirePermission } from "@/platform/auth/server";
import { PortalScreen } from "../_components/PortalScreen";

export default async function MyAttendancePage() {
  await requirePermission("attendance.self.read");
  return <PortalScreen via="self" />;
}
