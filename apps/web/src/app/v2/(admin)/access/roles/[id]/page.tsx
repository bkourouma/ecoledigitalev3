import type { Metadata } from "next";
import { RoleDetailPage } from "@/platform/admin/roles/RoleDetailPage";

export const metadata: Metadata = { title: "Rôle" };

export default async function RoleRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RoleDetailPage id={id} />;
}
