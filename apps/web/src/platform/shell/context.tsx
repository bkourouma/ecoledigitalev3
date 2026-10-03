"use client";

import { createContext, useContext } from "react";
import type { MenuItem } from "@/platform/navigation/types";

export type ShellContextValue =
  | { kind: "management"; items: readonly MenuItem[]; isLoading: boolean }
  | { kind: "portal"; portal: "parent" | "student" | "teacher"; items: readonly MenuItem[]; isLoading: boolean };

const ShellContext = createContext<ShellContextValue | null>(null);

export const ShellMenuProvider = ShellContext.Provider;

/** Menu et type de la coque courante (accueil de gestion, tests) ; `null` hors coque. */
export function useShellMenu(): ShellContextValue | null {
  return useContext(ShellContext);
}
