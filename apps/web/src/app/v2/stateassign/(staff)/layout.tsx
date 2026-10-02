import type { ReactNode } from "react";
import { StateassignShell } from "../_components/StateassignShell";

/** Habillage des écrans du personnel : navigation de section (chaque entrée suit la permission de son écran). */
export default function StateassignStaffLayout({ children }: { children: ReactNode }) {
  return <StateassignShell>{children}</StateassignShell>;
}
