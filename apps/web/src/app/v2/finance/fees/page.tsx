import { requirePermission } from "@/platform/auth/server";
import { FeesScreen } from "../_components/Catalog";

export default async function Page() {
  await requirePermission("finance.fee.read");
  return <FeesScreen />;
}
