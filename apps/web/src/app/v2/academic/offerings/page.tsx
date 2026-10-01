import { requirePermission } from "@/platform/auth/server";
import { OfferingsScreen } from "../_components/OfferingsScreen";

export default async function OfferingsPage() {
  await requirePermission("academic.classroom.read");
  return <OfferingsScreen />;
}
