import type { Metadata } from "next";
import { AuditPage } from "@/platform/admin/audit/AuditPage";

export const metadata: Metadata = { title: "Journal d'audit" };

export default function AuditRoute() {
  return <AuditPage />;
}
