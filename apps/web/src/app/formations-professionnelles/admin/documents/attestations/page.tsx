"use client";

import { AdminDocuments } from "@/components/admin/documents/AdminDocuments";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default function AttestationsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin" },
          { label: "Documents", href: "/formations-professionnelles/admin/documents" },
          { label: "Attestations" },
        ]}
        className="mb-6"
      />
      <AdminDocuments />
    </div>
  );
}

