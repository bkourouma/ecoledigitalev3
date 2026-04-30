/**
 * Admin Exports Page
 */

"use client";

import { AdminExports } from "@/components/admin/exports/AdminExports";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default function AdminExportsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin" },
          { label: "Exports" },
        ]}
        className="mb-6"
      />
      <AdminExports />
    </div>
  );
}

