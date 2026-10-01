import type { Metadata } from "next";
import { AuditDetailPage } from "@/platform/admin/audit/AuditDetail";

export const metadata: Metadata = { title: "Entrée du journal d'audit" };

export default async function AuditEntryRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AuditDetailPage id={id} />;
}
