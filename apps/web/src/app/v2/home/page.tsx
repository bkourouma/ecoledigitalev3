import type { Metadata } from "next";
import { HomeScreen } from "@/platform/shell/HomeScreen";

export const metadata: Metadata = { title: "Accueil" };

/** Accueil : raccourcis par module selon le rôle (le menu de la coque ne contient que ce que le rôle peut ouvrir). */
export default function HomePage() {
  return <HomeScreen />;
}
