import { requirePermission } from "@/platform/auth/server";
import { ImportAssistant } from "../_components/ImportAssistant";

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("imports.read");
  const { id } = await params;
  return <ImportAssistant jobId={id} />;
}
