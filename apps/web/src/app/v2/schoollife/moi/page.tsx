import { requirePermission } from "@/platform/auth/server";
import { FamilyScreen } from "../_components/FamilyScreen";

export default async function SchoolLifeMyPage() {
  await requirePermission("schoollife.self.read");
  return <FamilyScreen mode="student" />;
}
