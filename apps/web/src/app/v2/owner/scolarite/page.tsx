import { requirePermission } from "@/platform/auth/server";
import { TuitionScreen } from "../_components/Finance";

export default async function OwnerTuitionPage() {
  await requirePermission("analytics.finance.read");
  return <TuitionScreen />;
}
