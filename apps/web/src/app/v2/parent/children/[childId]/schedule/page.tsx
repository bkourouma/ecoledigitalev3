import { requirePermission } from "@/platform/auth/server";
import { ChildSchedule } from "../../../_components/ChildScreens";

export default async function ChildSchedulePage({ params }: { params: Promise<{ childId: string }> }) {
  await requirePermission("schedule.child.read");
  const { childId } = await params;
  return <ChildSchedule childId={childId} />;
}
