import type { Metadata } from "next";
import { PlansPage } from "@/platform/admin/console/PlansPage";

export const metadata: Metadata = { title: "Plans et catalogue" };

export default function PlansRoute() {
  return <PlansPage />;
}
