import { requirePermission } from "@/platform/auth/server";
import { RuleSetsScreen } from "./_components/RuleSetsScreen";

export default async function RulesCatalogPage() {
  await requirePermission("rules.ruleset.read");
  return <RuleSetsScreen />;
}
