/**
 * Admin Enterprise Create Page
 */

"use client";

import { useRouter } from "next/navigation";
import { EntrepriseFormModal } from "@/components/admin/entreprises/EntrepriseFormModal";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { useState } from "react";

export default function AdminEnterpriseCreatePage() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(true);

  const handleClose = () => {
    setModalOpen(false);
    router.push("/formations-professionnelles/admin/entreprises");
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin" },
          { label: "Entreprises", href: "/formations-professionnelles/admin/entreprises" },
          { label: "Ajouter" },
        ]}
        className="mb-6"
      />
      <EntrepriseFormModal open={modalOpen} onOpenChange={handleClose} enterprise={null} />
    </div>
  );
}

