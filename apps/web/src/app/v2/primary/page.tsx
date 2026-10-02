import { redirect } from "next/navigation";
import { fetchPermissions, requireSession } from "@/platform/auth/server";
import { hasPermission } from "@/platform/auth/policies";

/** `/v2/primary` n'a pas de contenu propre : on ouvre l'écran qui correspond au profil (direction, famille, instituteur). */
export default async function PrimaryIndexPage() {
  const session = await requireSession();
  const granted = (await fetchPermissions(session).catch(() => null)) ?? [];
  if (hasPermission(granted, "primary.class.read_all") && hasPermission(granted, "primary.report.read")) redirect("/v2/primary/direction");
  if (hasPermission(granted, "primary.bilan.child.read") || hasPermission(granted, "primary.bilan.self.read")) redirect("/v2/primary/mon-enfant");
  redirect("/v2/primary/classe");
}
