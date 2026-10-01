import { requirePermission } from "@/platform/auth/server";
import { GuardianDetail } from "../_components/Guardians";

export default async function GuardianDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("guardian.read");
  const { id } = await params;
  return <GuardianDetail id={id} />;
}
