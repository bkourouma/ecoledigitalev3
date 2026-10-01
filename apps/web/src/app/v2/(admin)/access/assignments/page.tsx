import type { Metadata } from "next";
import { AssignmentsPage } from "@/platform/admin/roles/AssignmentsPage";

export const metadata: Metadata = { title: "Attributions de rôles" };

export default function AssignmentsRoute() {
  return <AssignmentsPage />;
}
