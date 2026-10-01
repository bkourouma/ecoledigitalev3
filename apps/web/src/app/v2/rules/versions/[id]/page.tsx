import { requirePermission } from "@/platform/auth/server";
import { RuleVersionScreen } from "../../_components/RuleVersionScreen";

export default async function RuleVersionPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("rules.ruleset.read");
  const { id } = await params;
  return <RuleVersionScreen id={id} />;
}
