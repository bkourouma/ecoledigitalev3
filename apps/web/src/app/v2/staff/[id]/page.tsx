import { requirePermission } from "@/platform/auth/server";
import { StaffDetail } from "../_components/StaffDetail";

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("staff.read");
  const { id } = await params;
  return <StaffDetail id={id} />;
}
