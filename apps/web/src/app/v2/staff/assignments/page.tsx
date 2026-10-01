import { requirePermission } from "@/platform/auth/server";
import { AssignmentsScreen } from "../_components/AssignmentsScreen";

const UUID = /^[0-9a-fA-F-]{36}$/;

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("teaching.read");
  const { classroomId } = await searchParams;
  return <AssignmentsScreen initialClassroomId={typeof classroomId === "string" && UUID.test(classroomId) ? classroomId : undefined} />;
}
