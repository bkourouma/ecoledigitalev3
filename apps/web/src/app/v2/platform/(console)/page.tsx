import { redirect } from "next/navigation";

export default function ConsoleIndexPage() {
  redirect("/v2/platform/tenants");
}
