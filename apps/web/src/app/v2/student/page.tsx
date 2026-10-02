import { redirect } from "next/navigation";

export default function StudentIndexPage() {
  redirect("/v2/student/me");
}
