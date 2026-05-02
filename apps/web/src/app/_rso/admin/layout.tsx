"use client";

import { RSOLayout } from "@/components/rso/admin/RSOLayout";
import { YearProvider } from "@/contexts/rso/YearContext";

export default function RSOAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <YearProvider>
      <RSOLayout>{children}</RSOLayout>
    </YearProvider>
  );
}


