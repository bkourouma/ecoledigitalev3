import { requirePermission } from "@/platform/auth/server";
import { ChildFinance } from "../../../_components/ChildScreens";

/** Scolarité de l'enfant : routes `/finance/me/*` (`finance.child.read`), propriété relue côté serveur à chaque requête. */
export default async function ChildFinancePage({ params }: { params: Promise<{ childId: string }> }) {
  await requirePermission("finance.child.read");
  const { childId } = await params;
  return <ChildFinance childId={childId} />;
}
