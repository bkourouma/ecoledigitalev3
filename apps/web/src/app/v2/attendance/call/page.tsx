import { requireAnyPermission } from "@/platform/auth/any-permission";
import { CallListScreen } from "../_components/CallListScreen";

export default async function CallListPage() {
  await requireAnyPermission("attendance.take", "attendance.manage");
  return <CallListScreen />;
}
