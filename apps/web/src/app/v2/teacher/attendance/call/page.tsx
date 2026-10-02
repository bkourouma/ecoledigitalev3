import { redirect } from "next/navigation";

/** `/v2/teacher/attendance/call` n'a pas de contenu propre : « Mes appels » liste les séances à faire. */
export default function TeacherCallIndexPage() {
  redirect("/v2/teacher/attendance");
}
