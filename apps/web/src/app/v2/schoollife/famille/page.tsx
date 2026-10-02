import { requirePermission } from "@/platform/auth/server";
import { FamilyScreen } from "../_components/FamilyScreen";

export default async function SchoolLifeFamilyPage() {
  await requirePermission("schoollife.child.read");
  return <FamilyScreen mode="guardian" />;
}
