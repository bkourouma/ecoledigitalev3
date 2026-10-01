import { requirePermission } from "@/platform/auth/server";
import { StudentCreateWizard } from "../_components/StudentCreateWizard";

export default async function NewStudentPage() {
  await requirePermission("student.create");
  return <StudentCreateWizard />;
}
