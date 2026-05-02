"use client";

import { RSOFormateurLayout } from "@/components/rso/formateur/RSOFormateurLayout";
import { YearProvider } from "@/contexts/rso/YearContext";

export default function RSOFormateurLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <YearProvider>
      <RSOFormateurLayout>{children}</RSOFormateurLayout>
    </YearProvider>
  );
}

