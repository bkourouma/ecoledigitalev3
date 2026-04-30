import { redirect } from "next/navigation";

type TeacherAssignmentEditPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function TeacherAssignmentEditPage({ params }: TeacherAssignmentEditPageProps) {
  const { id } = await params;
  redirect(`/academic/assignments/${id}/edit`);
}

