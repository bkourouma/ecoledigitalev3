import type { Metadata } from "next";
import { OperatorLoginPage } from "@/platform/admin/console/OperatorLoginPage";

export const metadata: Metadata = { title: "Connexion à la console plateforme" };

export default function OperatorLoginRoute() {
  return <OperatorLoginPage />;
}
