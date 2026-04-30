"use client";

import { RSOPFSOLayout } from "@/components/rso/pfso/RSOPFSOLayout";
import { YearProvider } from "@/contexts/rso/YearContext";

export default function RSOPFSOLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <YearProvider>
      <RSOPFSOLayout>{children}</RSOPFSOLayout>
    </YearProvider>
  );
}

