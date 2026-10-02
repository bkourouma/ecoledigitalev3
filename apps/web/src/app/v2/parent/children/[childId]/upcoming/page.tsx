import { requirePermission } from "@/platform/auth/server";
import { ChildUpcoming } from "../../../_components/ChildScreens";

export default async function ChildUpcomingPage({ params }: { params: Promise<{ childId: string }> }) {
  await requirePermission("schedule.child.read");
  const { childId } = await params;
  return <ChildUpcoming childId={childId} />;
}
