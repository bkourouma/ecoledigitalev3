/**
 * EntrepriseDetailPage Component
 * 
 * Component displaying enterprise details with tabs (Informations, Inscriptions, Factures)
 */

"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger, Card, CardContent, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { Building2, Users, DollarSign, FileText, Edit, Download } from "lucide-react";
import { useEntrepriseDetails, useGenerateFacturationGroupee } from "@/lib/hooks/use-entreprises";
import { EntrepriseDetailResponse } from "@ecoledigitale/contracts/src/entreprises";
import { Loader2 } from "lucide-react";
import { FacturationGroupeeModal } from "./FacturationGroupeeModal";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

// Format currency helper
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "XOF",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

interface EntrepriseDetailPageProps {
  entrepriseId: string;
  onEdit?: () => void;
}

export function EntrepriseDetailPage({ entrepriseId, onEdit }: EntrepriseDetailPageProps) {
  const { data, isLoading, error } = useEntrepriseDetails(entrepriseId);
  const [facturationModalOpen, setFacturationModalOpen] = useState(false);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-3 text-foreground/80">Chargement des détails...</span>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <p className="text-destructive mb-2">Erreur lors du chargement</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Entreprise introuvable"}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const entreprise = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold whitespace-nowrap text-2xl leading-tight md:text-3xl">{entreprise.raison_sociale}</h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            {entreprise.siret && `SIRET: ${entreprise.siret}`}
          </p>
        </div>
        <div className="flex gap-2">
          {onEdit && (
            <Button variant="outline" onClick={onEdit}>
              <Edit className="h-4 w-4 mr-2" />
              Modifier
            </Button>
          )}
          {entreprise.inscriptions.length > 0 && (
            <Button onClick={() => setFacturationModalOpen(true)}>
              <FileText className="h-4 w-4 mr-2" />
              Facturation groupée
            </Button>
          )}
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Inscriptions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <div className="text-2xl font-bold">{entreprise.statistiques.nb_inscriptions}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Apprenants</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <div className="text-2xl font-bold">{entreprise.statistiques.nb_apprenants}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">CA Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              <div className="text-2xl font-bold">{formatCurrency(entreprise.statistiques.ca_total)}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Formations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <div className="text-2xl font-bold">{entreprise.statistiques.formations_suivies.length}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="informations" className="space-y-4">
        <TabsList>
          <TabsTrigger value="informations">Informations</TabsTrigger>
          <TabsTrigger value="inscriptions">Inscriptions ({entreprise.inscriptions.length})</TabsTrigger>
          <TabsTrigger value="factures">Factures</TabsTrigger>
        </TabsList>

        <TabsContent value="informations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Informations de l'entreprise</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Raison sociale</p>
                  <p className="text-sm">{entreprise.raison_sociale}</p>
                </div>
                {entreprise.siret && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">SIRET</p>
                    <p className="text-sm">{entreprise.siret}</p>
                  </div>
                )}
                {entreprise.forme_juridique && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Forme juridique</p>
                    <p className="text-sm">{entreprise.forme_juridique}</p>
                  </div>
                )}
                {entreprise.secteur_activite && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Secteur d'activité</p>
                    <p className="text-sm">{entreprise.secteur_activite}</p>
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Adresse</p>
                <p className="text-sm">
                  {entreprise.adresse}
                  {entreprise.code_postal && `, ${entreprise.code_postal}`} {entreprise.ville}
                  {entreprise.pays && `, ${entreprise.pays}`}
                </p>
              </div>
              {entreprise.nombre_employes && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Nombre d'employés</p>
                  <p className="text-sm">{entreprise.nombre_employes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Nom</p>
                <p className="text-sm">{entreprise.contact_prenom} {entreprise.contact_nom}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Email</p>
                <p className="text-sm">{entreprise.contact_email}</p>
              </div>
              {entreprise.contact_telephone && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Téléphone</p>
                  <p className="text-sm">{entreprise.contact_telephone}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {entreprise.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{entreprise.notes}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="inscriptions" className="space-y-4">
          {entreprise.inscriptions.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <div className="text-center">
                  <p className="text-muted-foreground">Aucune inscription trouvée</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {entreprise.inscriptions.map((inscription) => (
                <Card key={inscription.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{inscription.formation}</p>
                          <span className={`text-xs px-2 py-1 rounded ${
                            inscription.statut === "confirmee" ? "bg-green-100 text-green-800" :
                            inscription.statut === "en_attente" ? "bg-yellow-100 text-yellow-800" :
                            "bg-gray-100 text-gray-800"
                          }`}>
                            {inscription.statut}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Session: {inscription.session_code}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Apprenant: {inscription.apprenant}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Date: {format(new Date(inscription.date_inscription), "dd MMMM yyyy", { locale: fr })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatCurrency(inscription.montant_ttc)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="factures" className="space-y-4">
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <p className="text-muted-foreground">Les factures groupées apparaîtront ici</p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setFacturationModalOpen(true)}
                  disabled={entreprise.inscriptions.length === 0}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Générer une facture groupée
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Facturation Groupée Modal */}
      <FacturationGroupeeModal
        open={facturationModalOpen}
        onOpenChange={setFacturationModalOpen}
        entrepriseId={entrepriseId}
        inscriptions={entreprise.inscriptions}
      />
    </div>
  );
}

