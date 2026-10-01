import type { Metadata } from "next";
import { ProfilePage } from "@/platform/admin/tenancy/ProfilePage";

export const metadata: Metadata = { title: "Profil et marque" };

export default function SettingsProfileRoute() {
  return <ProfilePage />;
}
