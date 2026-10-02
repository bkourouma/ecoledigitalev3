import { requirePermission } from "@/platform/auth/server";
import { ValidationsScreen } from "../_components/ValidationsScreen";

export default async function SchoolLifeValidationsPage() {
  await requirePermission("schoollife.measure.validate");
  return <ValidationsScreen />;
}
