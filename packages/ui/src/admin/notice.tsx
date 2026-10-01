import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utils";

const noticeVariants = cva("rounded-md border p-3 text-sm", {
  variants: {
    tone: {
      info: "border-blue-200 bg-blue-50 text-blue-900",
      success: "border-green-200 bg-green-50 text-green-900",
      warning: "border-amber-300 bg-amber-50 text-amber-900",
      danger: "border-destructive/50 bg-destructive/5 text-destructive",
    },
  },
  defaultVariants: { tone: "info" },
});

export interface NoticeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof noticeVariants> {}

/** Bandeau d'information. `danger` et `warning` sont annoncés (`role="alert"`), les autres poliment (`status`). */
export function Notice({ tone, className, role, ...props }: NoticeProps) {
  const resolved = role ?? (tone === "danger" || tone === "warning" ? "alert" : "status");
  return <div role={resolved} className={cn(noticeVariants({ tone }), className)} {...props} />;
}
