import { requirePermission } from "@/platform/auth/server";
import { TimetableEditor } from "../../_components/TimetableEditor";

export default async function TimetableEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("schedule.read");
  const { id } = await params;
  return <TimetableEditor id={id} />;
}
