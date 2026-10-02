import { requirePermission } from "@/platform/auth/server";
import { ConvocationsScreen } from "../_components/ConvocationsScreen";

export default async function SchoolLifeConvocationsPage() {
  await requirePermission("schoollife.convocation.manage");
  return <ConvocationsScreen />;
}
