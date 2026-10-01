import { requireAnyPermission } from "@/platform/auth/any-permission";
import { StaffScreen } from "./_components/StaffScreen";

export default async function StaffPage() {
  // `staff.read` suffit à lister (modèles de rôles de l'économe et du directeur des études).
  await requireAnyPermission("staff.list", "staff.read");
  return <StaffScreen />;
}
