import { requirePermission } from "@/platform/auth/server";
import { ClassroomsScreen } from "../_components/ClassroomsScreen";

export default async function ClassroomsPage() {
  await requirePermission("academic.classroom.read");
  return <ClassroomsScreen />;
}
