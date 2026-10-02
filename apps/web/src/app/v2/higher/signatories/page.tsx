import { requirePermission } from "@/platform/auth/server";
import { SlotsScreen } from "../_components/SlotsScreen";

export default async function HigherSignatoriesPage() {
  await requirePermission("higher.slot.manage");
  return <SlotsScreen />;
}
