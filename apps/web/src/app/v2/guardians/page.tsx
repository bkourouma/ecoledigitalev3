import { requirePermission } from "@/platform/auth/server";
import { GuardiansScreen } from "./_components/Guardians";

export default async function GuardiansPage() {
  await requirePermission("guardian.read");
  return <GuardiansScreen />;
}
