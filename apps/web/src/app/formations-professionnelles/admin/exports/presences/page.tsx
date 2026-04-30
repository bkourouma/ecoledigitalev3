/**
 * Export Presences Page
 */

"use client";

import { ExportPresencesCard } from "@/components/admin/exports/ExportPresencesCard";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default function ExportPresencesPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin" },
          { label: "Exports", href: "/formations-professionnelles/admin/exports" },
          { label: "Présences" },
        ]}
        className="mb-6"
      />
      <ExportPresencesCard />
    </div>
  );
}

