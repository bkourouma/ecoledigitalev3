import { redirect } from "next/navigation";

/** `/v2/higher` n'a pas de contenu propre : on ouvre les diplômes. */
export default function HigherIndexPage() {
  redirect("/v2/higher/diplomas");
}
