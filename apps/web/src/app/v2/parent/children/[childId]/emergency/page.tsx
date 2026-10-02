import { requirePermission } from "@/platform/auth/server";
import { ChildFile } from "../../../_components/ChildScreens";

export default async function ChildFilePage({ params }: { params: Promise<{ childId: string }> }) {
  await requirePermission("student.child.read");
  const { childId } = await params;
  return <ChildFile childId={childId} />;
}
