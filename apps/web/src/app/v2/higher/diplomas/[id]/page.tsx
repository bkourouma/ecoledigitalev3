import { requirePermission } from "@/platform/auth/server";
import { DiplomaDetail } from "../../_components/DiplomaDetail";

export default async function HigherDiplomaPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("higher.diploma.read");
  const { id } = await params;
  return <DiplomaDetail id={id} />;
}
