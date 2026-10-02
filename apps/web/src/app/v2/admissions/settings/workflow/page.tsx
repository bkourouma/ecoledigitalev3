import { requirePermission } from "@/platform/auth/server";
import { WorkflowScreen } from "../../_components/WorkflowScreen";

export default async function AdmissionsWorkflowPage() {
  await requirePermission("admission.workflow.manage");
  return <WorkflowScreen />;
}
