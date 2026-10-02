import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { isUuid } from "@/platform/portal/ids";
import { FamilyReceiptDetail } from "../../../../../_family/FamilyFinance";

/** Reçu d'un enfant (parent) ou de soi-même (élève) : route famille `/finance/me/*`, retour vers la situation financière de l'apprenant. */
export default async function MyReceiptPage({ params }: { params: Promise<{ learnerId: string; id: string }> }) {
  await requireAnyPermission("finance.child.read", "finance.self.read");
  const { learnerId, id } = await params;
  if (!isUuid(learnerId) || !isUuid(id)) notFound();
  return <FamilyReceiptDetail learnerId={learnerId} id={id} backHref={`/v2/finance/me/${learnerId}`} />;
}
