import { requirePermission } from "@/platform/auth/server";
import { PedagogyScreen } from "../_components/Pedagogy";

export default async function OwnerPedagogyPage() {
  await requirePermission("analytics.pedagogy.read");
  return <PedagogyScreen />;
}
