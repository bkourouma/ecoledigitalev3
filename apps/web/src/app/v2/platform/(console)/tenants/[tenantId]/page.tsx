import type { Metadata } from "next";
import { TenantDetailPage } from "@/platform/admin/console/TenantDetailPage";

export const metadata: Metadata = { title: "Organisation" };

export default async function TenantDetailRoute({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return <TenantDetailPage tenantId={tenantId} />;
}
