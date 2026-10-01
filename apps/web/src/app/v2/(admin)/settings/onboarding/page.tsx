import type { Metadata } from "next";
import { OnboardingPage } from "@/platform/admin/tenancy/OnboardingPage";

export const metadata: Metadata = { title: "Mise en service" };

export default function OnboardingRoute() {
  return <OnboardingPage />;
}
