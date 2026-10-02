import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PipelineScreen } from "./_components/PipelineScreen";
import { VIEW_PERMISSIONS } from "./_components/admissions-utils";

export default async function AdmissionsPipelinePage() {
  await requireAnyPermission(...VIEW_PERMISSIONS);
  return <PipelineScreen />;
}
