import { requirePermission } from "@/platform/auth/server";
import { ProgramsScreen } from "../_components/ProgramsScreen";

export default async function ProgramsPage() {
  await requirePermission("academic.program.read");
  return <ProgramsScreen />;
}
