import { redirect } from "next/navigation";

/** `/v2` n'a pas de contenu propre : on ouvre l'administration de l'établissement. */
export default function V2IndexPage() {
  redirect("/v2/settings");
}
