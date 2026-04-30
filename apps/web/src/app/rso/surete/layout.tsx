"use client";

import { RSOSureteLayout } from "@/components/rso/surete/RSOSureteLayout";

export default function RSOSureteLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  // Agents de sûreté n'ont pas besoin de YearProvider car ils n'ont pas accès aux années
  return <RSOSureteLayout>{children}</RSOSureteLayout>;
}

