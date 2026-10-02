import { requirePermission } from "@/platform/auth/server";
import { ParentHome } from "./_components/ParentHome";

export default async function ParentHomePage() {
  await requirePermission("student.child.read");
  return <ParentHome />;
}
