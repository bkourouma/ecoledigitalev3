import { requirePermission } from "@/platform/auth/server";
import { CategoriesScreen } from "../_components/CategoriesScreen";

export default async function DocumentCategoriesPage() {
  await requirePermission("documents.category.manage");
  return <CategoriesScreen />;
}
