import { requirePermission } from "@/platform/auth/server";
import { RoomsScreen } from "../_components/RoomsScreen";

export default async function RoomsPage() {
  await requirePermission("schedule.read");
  return <RoomsScreen />;
}
