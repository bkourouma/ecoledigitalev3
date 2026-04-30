/**
 * Export Inscriptions Page
 */

"use client";

import { ExportInscriptionsCard } from "@/components/admin/exports/ExportInscriptionsCard";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default function ExportInscriptionsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin" },
          { label: "Exports", href: "/formations-professionnelles/admin/exports" },
          { label: "Inscriptions" },
        ]}
        className="mb-6"
      />
      <ExportInscriptionsCard />
    </div>
  );
}

