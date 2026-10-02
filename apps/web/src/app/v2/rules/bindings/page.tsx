import { requirePermission } from "@/platform/auth/server";
import { BindingsScreen } from "../_components/BindingsScreen";

export default async function RulesBindingsPage() {
  await requirePermission("rules.ruleset.read");
  return <BindingsScreen />;
}
