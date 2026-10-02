import { requirePermission } from "@/platform/auth/server";
import { SchoolLifeScreen } from "../_components/Funnel";

export default async function Page() {
  await requirePermission("analytics.schoollife.read");
  return <SchoolLifeScreen />;
}
