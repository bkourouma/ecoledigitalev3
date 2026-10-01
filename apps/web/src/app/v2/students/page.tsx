import { requireAnyPermission } from "@/platform/auth/any-permission";
import { StudentsScreen } from "./_components/StudentsScreen";

export default async function StudentsPage() {
  // Secrétariat / direction : `student.list` ; enseignant : ses classes seulement (`student.class.read`, périmètre appliqué par l'API).
  await requireAnyPermission("student.list", "student.class.read");
  return <StudentsScreen />;
}
