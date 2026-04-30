/**
 * Admin Reporting Dashboard Page
 */

"use client";

import { ReportingDashboard } from "@/components/admin/reporting/ReportingDashboard";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default function AdminReportingDashboardPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin" },
          { label: "Reporting", href: "/formations-professionnelles/admin/reporting" },
          { label: "Tableau de bord" },
        ]}
        className="mb-6"
      />
      <ReportingDashboard />
    </div>
  );
}

