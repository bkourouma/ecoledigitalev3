import { requirePermission } from "@/platform/auth/server";
import { PERM } from "../../_components/permissions";
import { VerificationScreen } from "../../_components/VerificationScreen";

export default async function StateassignVerificationPage() {
  await requirePermission(PERM.verify);
  return <VerificationScreen />;
}
