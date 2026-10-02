import { requirePermission } from "@/platform/auth/server";
import { SessionDetailScreen } from "../../_components/SessionDetailScreen";

export default async function ExaminationSessionPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("exam.session.read");
  const { id } = await params;
  return <SessionDetailScreen id={id} />;
}
