/**
 * Admin Enterprise Edit Page
 */

"use client";

import { useParams, useRouter } from "next/navigation";
import { EntrepriseFormModal } from "@/components/admin/entreprises/EntrepriseFormModal";
import { useEntrepriseDetails } from "@/lib/hooks/use-entreprises";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@ecoledigitale/ui";
import { useState } from "react";

export default function AdminEnterpriseEditPage() {
  const params = useParams();
  const router = useRouter();
  const entrepriseId = params.id as string;
  const [modalOpen, setModalOpen] = useState(true);
  const { data, isLoading } = useEntrepriseDetails(entrepriseId);

  const handleClose = () => {
    setModalOpen(false);
    router.push(`/formations-professionnelles/admin/entreprises/${entrepriseId}/details`);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-foreground/80">Chargement...</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <p className="text-destructive mb-2">Entreprise introuvable</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Convert detail response to WithStats format for the form
  const enterprise = {
    ...data,
    nb_inscriptions: data.statistiques.nb_inscriptions,
    nb_apprenants: data.statistiques.nb_apprenants,
    ca_total: data.statistiques.ca_total,
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Breadcrumb
        items={[
          { label: "Administration", href: "/formations-professionnelles/admin" },
          { label: "Entreprises", href: "/formations-professionnelles/admin/entreprises" },
          { label: "Détails", href: `/formations-professionnelles/admin/entreprises/${entrepriseId}/details` },
          { label: "Modifier" },
        ]}
        className="mb-6"
      />
      <EntrepriseFormModal open={modalOpen} onOpenChange={handleClose} enterprise={enterprise} />
    </div>
  );
}

