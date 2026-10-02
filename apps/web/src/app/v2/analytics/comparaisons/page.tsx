import { requirePermission } from "@/platform/auth/server";
import { CompareScreen } from "../_components/Compare";

export default async function Page() {
  await requirePermission("analytics.read");
  return <CompareScreen />;
}
