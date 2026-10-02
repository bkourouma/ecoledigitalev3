import { requirePermission } from "@/platform/auth/server";
import { ParentAccount } from "../_components/ParentAccount";

export default async function ParentAccountPage() {
  await requirePermission("student.child.read");
  return <ParentAccount />;
}
