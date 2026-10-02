import { requirePermission } from "@/platform/auth/server";
import { CreditsScreen } from "../_components/CreditsScreen";

export default async function HigherCreditsPage() {
  await requirePermission("higher.credits.read");
  return <CreditsScreen />;
}
