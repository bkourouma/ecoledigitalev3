import { requirePermission } from "@/platform/auth/server";
import { StaffCreate } from "../_components/StaffCreate";

export default async function NewStaffPage() {
  await requirePermission("staff.create");
  return <StaffCreate />;
}
