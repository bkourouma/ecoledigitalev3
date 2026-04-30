/**
 * Export Paiements Page
 */

"use client";

import { ExportPaiementsCard } from "@/components/admin/exports/ExportPaiementsCard";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default function ExportPaiementsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin" },
          { label: "Exports", href: "/formations-professionnelles/admin/exports" },
          { label: "Paiements" },
        ]}
        className="mb-6"
      />
      <ExportPaiementsCard />
    </div>
  );
}

