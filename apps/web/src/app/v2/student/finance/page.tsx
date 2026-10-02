import { requirePermission } from "@/platform/auth/server";
import { StudentFinance } from "../_components/StudentScreens";

/** Scolarité de l'élève : routes `/finance/me/*` (`finance.self.read`), identité de l'élève relue côté serveur. */
export default async function StudentFinancePage() {
  await requirePermission("finance.self.read");
  return <StudentFinance />;
}
