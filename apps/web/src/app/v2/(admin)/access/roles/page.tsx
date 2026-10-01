import type { Metadata } from "next";
import { RolesPage } from "@/platform/admin/roles/RolesPage";

export const metadata: Metadata = { title: "Rôles et permissions" };

export default function RolesRoute() {
  return <RolesPage />;
}
