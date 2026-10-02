import { requirePermission } from "@/platform/auth/server";
import { MyRecordScreen } from "../_components/MyRecord";

export default async function MyRecordPage() {
  await requirePermission("student.self.read");
  return <MyRecordScreen />;
}
