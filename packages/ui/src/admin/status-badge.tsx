import * as React from "react";
import { Badge } from "../badge";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE_VARIANT = {
  neutral: "secondary",
  success: "success",
  warning: "warning",
  danger: "destructive",
  info: "info",
} as const;

export interface StatusBadgeProps {
  tone: StatusTone;
  /** Libellé TEXTUEL obligatoire : la couleur ne porte jamais seule l'information. */
  children: React.ReactNode;
  className?: string;
}

export function StatusBadge({ tone, children, className }: StatusBadgeProps) {
  return (
    <Badge variant={TONE_VARIANT[tone]} className={className}>
      {children}
    </Badge>
  );
}
