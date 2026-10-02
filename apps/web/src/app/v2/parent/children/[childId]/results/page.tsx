import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ChildResults } from "../../../_components/ChildScreens";

export default async function ChildResultsPage({ params }: { params: Promise<{ childId: string }> }) {
  await requireAnyPermission("grade.child.read", "result.child.read");
  const { childId } = await params;
  return <ChildResults childId={childId} />;
}
