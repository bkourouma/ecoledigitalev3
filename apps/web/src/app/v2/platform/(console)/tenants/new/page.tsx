import type { Metadata } from "next";
import { ProvisionTenantPage } from "@/platform/admin/console/ProvisionTenantPage";

export const metadata: Metadata = { title: "Nouvelle organisation" };

export default function ProvisionTenantRoute() {
  return <ProvisionTenantPage />;
}
