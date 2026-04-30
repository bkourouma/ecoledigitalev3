"use client";

import { useRouter } from "next/navigation";
import { FormateurForm } from "@/components/admin/formateurs/FormateurForm";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { ArrowLeft } from "lucide-react";
import { Button } from "@ecoledigitale/ui";

export default function CreerFormateurPage() {
  const router = useRouter();

  const handleSuccess = (formateurId: string) => {
    router.push("/formations-professionnelles/admin/formateurs");
  };

  const handleCancel = () => {
    router.push("/formations-professionnelles/admin/formateurs");
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin" },
          { label: "Formateurs", href: "/formations-professionnelles/admin/formateurs" },
          { label: "Créer" },
        ]}
        className="mb-6"
      />

      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={handleCancel}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Retour à la liste
        </Button>
      </div>

      <FormateurForm onSuccess={handleSuccess} onCancel={handleCancel} />
    </div>
  );
}

