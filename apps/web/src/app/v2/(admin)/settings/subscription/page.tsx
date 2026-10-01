import type { Metadata } from "next";
import { SubscriptionPage } from "@/platform/admin/tenancy/SubscriptionPage";

export const metadata: Metadata = { title: "Abonnement et usage" };

export default function SubscriptionRoute() {
  return <SubscriptionPage />;
}
