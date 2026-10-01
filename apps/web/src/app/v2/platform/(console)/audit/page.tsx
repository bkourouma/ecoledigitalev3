import type { Metadata } from "next";
import { PlatformAuditPage } from "@/platform/admin/console/PlatformAuditPage";

export const metadata: Metadata = { title: "Journal de plateforme" };

export default function PlatformAuditRoute() {
  return <PlatformAuditPage />;
}
