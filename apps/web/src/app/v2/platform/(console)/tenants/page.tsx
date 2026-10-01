import type { Metadata } from "next";
import { TenantsPage } from "@/platform/admin/console/TenantsPage";

export const metadata: Metadata = { title: "Organisations" };

export default function TenantsRoute() {
  return <TenantsPage />;
}
