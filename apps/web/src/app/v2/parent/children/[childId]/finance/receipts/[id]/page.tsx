import { notFound } from "next/navigation";
import { requirePermission } from "@/platform/auth/server";
import { isUuid } from "@/platform/portal/ids";
import { ChildReceipt } from "../../../../../_components/ChildScreens";

export default async function ChildReceiptPage({ params }: { params: Promise<{ childId: string; id: string }> }) {
  await requirePermission("finance.child.read");
  const { childId, id } = await params;
  if (!isUuid(id)) notFound();
  return <ChildReceipt childId={childId} id={id} />;
}
