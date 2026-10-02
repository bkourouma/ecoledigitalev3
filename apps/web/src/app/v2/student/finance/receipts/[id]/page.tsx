import { notFound } from "next/navigation";
import { requirePermission } from "@/platform/auth/server";
import { isUuid } from "@/platform/portal/ids";
import { StudentReceipt } from "../../../_components/StudentScreens";

export default async function StudentReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("finance.self.read");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <StudentReceipt id={id} />;
}
