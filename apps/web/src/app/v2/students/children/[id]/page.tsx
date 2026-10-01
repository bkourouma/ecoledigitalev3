import { requirePermission } from "@/platform/auth/server";
import { ChildDetail } from "../../_components/MyChildren";

export default async function ChildDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("student.child.read");
  const { id } = await params;
  return <ChildDetail id={id} />;
}
