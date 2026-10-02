import { requirePermission } from "@/platform/auth/server";
import { AttestationsScreen } from "../_components/AttestationsScreen";

export default async function HigherAttestationsPage() {
  await requirePermission("higher.diploma.read");
  return <AttestationsScreen />;
}
