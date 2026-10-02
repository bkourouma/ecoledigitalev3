import { requirePermission } from "@/platform/auth/server";
import { FamilyScreen } from "../_components/FamilyScreen";
import { PERM } from "../_components/permissions";

/** Vue FAMILLE : le statut de l'affectation de ses enfants (jamais les montants de l'État). Lien de tutelle relu par l'API. */
export default async function StateassignFamilyPage() {
  await requirePermission(PERM.childRead);
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <FamilyScreen />
    </div>
  );
}
