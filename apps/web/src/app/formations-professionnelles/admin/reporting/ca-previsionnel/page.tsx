/**
 * Admin CA Prévisionnel Page
 */

"use client";

import { CAPrevisionnel } from "@/components/admin/reporting/CAPrevisionnel";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default function AdminCAPrevisionnelPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin" },
          { label: "Reporting", href: "/formations-professionnelles/admin/reporting" },
          { label: "CA Prévisionnel" },
        ]}
        className="mb-6"
      />
      <CAPrevisionnel />
    </div>
  );
}

