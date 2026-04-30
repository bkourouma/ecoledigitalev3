/**
 * Admin Enterprises List Page
 */

"use client";

import { AdminEntreprises } from "@/components/admin/entreprises/AdminEntreprises";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default function AdminEntreprisesPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin" },
          { label: "Entreprises" },
        ]}
        className="mb-6"
      />
      <AdminEntreprises />
    </div>
  );
}

