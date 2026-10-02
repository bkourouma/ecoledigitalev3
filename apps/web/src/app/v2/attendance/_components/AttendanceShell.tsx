"use client";

import type { ReactNode } from "react";
import { OutboxProvider } from "@/platform/offline/OutboxProvider";
import { AttendanceNav } from "./AttendanceNav";

export function AttendanceShell({ children }: { children: ReactNode }) {
  return (
    <OutboxProvider>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <AttendanceNav />
        {children}
      </div>
    </OutboxProvider>
  );
}
