/**
 * Admin Enterprise Detail Page
 */

"use client";

import { useParams, useRouter } from "next/navigation";
import { EntrepriseDetailPage } from "@/components/admin/entreprises/EntrepriseDetailPage";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export default function AdminEnterpriseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const entrepriseId = params.id as string;

  const handleEdit = () => {
    router.push(`/formations-professionnelles/admin/entreprises/${entrepriseId}/modifier`);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin" },
          { label: "Entreprises", href: "/formations-professionnelles/admin/entreprises" },
          { label: "Détails" },
        ]}
        className="mb-6"
      />
      <EntrepriseDetailPage entrepriseId={entrepriseId} onEdit={handleEdit} />
    </div>
  );
}

