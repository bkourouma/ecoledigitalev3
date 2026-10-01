import { requirePermission } from "@/platform/auth/server";
import { MyChildrenScreen } from "../_components/MyChildren";

export default async function MyChildrenPage() {
  await requirePermission("student.child.read");
  return <MyChildrenScreen />;
}
