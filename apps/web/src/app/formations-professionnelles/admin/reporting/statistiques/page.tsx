/**
 * Admin Statistics Page
 */

"use client";

import { StatisticsView } from "@/components/admin/reporting/StatisticsView";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default function AdminStatisticsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin" },
          { label: "Reporting", href: "/formations-professionnelles/admin/reporting" },
          { label: "Statistiques" },
        ]}
        className="mb-6"
      />
      <StatisticsView />
    </div>
  );
}

