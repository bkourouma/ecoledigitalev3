import { requirePermission } from "@/platform/auth/server";
import { EnrollmentWizard } from "../_components/EnrollmentWizard";

const UUID = /^[0-9a-fA-F-]{36}$/;
const pick = (value: string | string[] | undefined) => (typeof value === "string" && UUID.test(value) ? value : undefined);

export default async function NewEnrollmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("enrollment.create");
  const params = await searchParams;
  return <EnrollmentWizard initialStudentId={pick(params.studentId)} initialClassroomId={pick(params.classroomId)} />;
}
