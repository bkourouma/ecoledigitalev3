import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ReceiptDetailScreen } from "../../../../_components/Receipts";

/** Reçu d'un enfant (parent) ou de soi-même (élève) : retour vers la situation financière de l'apprenant. */
export default async function MyReceiptPage({ params }: { params: Promise<{ learnerId: string; id: string }> }) {
  await requireAnyPermission("student.child.read", "student.self.read");
  const { learnerId, id } = await params;
  return <ReceiptDetailScreen id={id} backHref={`/v2/finance/me/${learnerId}`} />;
}
