import { redirect } from "next/navigation";

export default function ParentDashboardRedirectPage() {
  redirect("/parent/children");
}
