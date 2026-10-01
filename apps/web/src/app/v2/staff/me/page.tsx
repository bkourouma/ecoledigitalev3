import { requirePermission } from "@/platform/auth/server";
import { MyStaffScreen } from "../_components/MyStaff";

export default async function MyStaffPage() {
  await requirePermission("staff.own.read");
  return <MyStaffScreen />;
}
