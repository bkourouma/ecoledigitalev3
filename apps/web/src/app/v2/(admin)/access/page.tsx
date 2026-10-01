import { redirect } from "next/navigation";

export default function AccessIndexPage() {
  redirect("/v2/access/roles");
}
