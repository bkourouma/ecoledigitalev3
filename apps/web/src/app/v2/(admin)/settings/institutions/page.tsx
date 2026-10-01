import type { Metadata } from "next";
import { InstitutionsPage } from "@/platform/admin/tenancy/InstitutionsPage";

export const metadata: Metadata = { title: "Établissements et campus" };

export default function InstitutionsRoute() {
  return <InstitutionsPage />;
}
