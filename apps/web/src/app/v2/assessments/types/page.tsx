import { requireAnyPermission } from "@/platform/auth/any-permission";
import { TypesScreen } from "../_components/TypesScreen";

export default async function AssessmentTypesPage() {
  await requireAnyPermission("assessment.type.read", "assessment.type.manage");
  return <TypesScreen />;
}
