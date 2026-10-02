import { requirePermission } from "@/platform/auth/server";
import { CardDetail } from "../_components/CardDetail";

export default async function ReportcardPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("reportcard.read");
  const { id } = await params;
  return <CardDetail id={id} />;
}
