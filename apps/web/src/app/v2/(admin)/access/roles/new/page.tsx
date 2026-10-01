import type { Metadata } from "next";
import { RoleCreatePage } from "@/platform/admin/roles/RoleCreatePage";

export const metadata: Metadata = { title: "Nouveau rôle" };

export default function NewRoleRoute() {
  return <RoleCreatePage />;
}
