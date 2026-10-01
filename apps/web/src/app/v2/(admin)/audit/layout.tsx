import type { ReactNode } from "react";
import { requirePermission } from "@/platform/auth/server";

export default async function AuditLayout({ children }: { children: ReactNode }) {
  await requirePermission("audit.read");
  return <>{children}</>;
}
