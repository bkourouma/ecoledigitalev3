import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ChildDocuments } from "../../../_components/ChildScreens";

export default async function ChildDocumentsPage({ params }: { params: Promise<{ childId: string }> }) {
  await requireAnyPermission("reportcard.child.read", "finance.child.read", "higher.child.read");
  const { childId } = await params;
  return <ChildDocuments childId={childId} />;
}
