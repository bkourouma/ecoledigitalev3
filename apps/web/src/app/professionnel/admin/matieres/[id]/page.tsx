"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
} from "@ecoledigitale/ui";
import { ArrowLeft, Edit, Loader2, AlertCircle, Info, FileText } from "lucide-react";
import { useProfessionalEcue } from "@/lib/hooks/use-professional-catalog-admin";
import { SubjectMaterialsPanel } from "@/components/professional/SubjectMaterialsPanel";

/**
 * Détails d'une ECUE — Module Professionnel (feature 030). Vue par onglets :
 * Informations (+ UE liées) et Supports de cours.
 */

const LIST_URL = "/professionnel/admin/matieres";

type Tab = "infos" | "supports";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? "—"}</p>
    </div>
  );
}

export default function ProfessionalEcueDetailPage() {
  const router = useRouter();
  const params = useParams();
  const ecueId = String(params?.id ?? "");
  const [activeTab, setActiveTab] = useState<Tab>("infos");

  const ecueQuery = useProfessionalEcue(ecueId || null);

  const ecue: any = ecueQuery.data;

  if (ecueQuery.isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-green-600" />
            <p className="text-gray-600 mt-3">Chargement de l'ECUE…</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (ecueQuery.isError || !ecue) {
    return (
      <div className="max-w-7xl mx-auto p-6 space-y-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <AlertCircle className="h-8 w-8 text-red-600" />
            </div>
            <p className="text-muted-foreground mt-3">
              {(ecueQuery.error as Error)?.message ?? "ECUE introuvable."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
    { id: "infos", label: "Informations", icon: Info },
    { id: "supports", label: "Supports de cours", icon: FileText },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent leading-tight text-2xl md:text-3xl">
              {ecue.libelle}
            </h1>
            <p className="text-muted-foreground font-mono whitespace-nowrap text-sm md:text-base">{ecue.code}</p>
          </div>
        </div>
        <Button
          onClick={() => router.push(`${LIST_URL}/${ecueId}/edit`)}
          className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white"
        >
          <Edit className="h-4 w-4 mr-2" />
          Modifier
        </Button>
      </div>

      {/* Onglets */}
      <div className="border-b border-border">
        <nav className="flex flex-wrap gap-2">
          {TABS.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  isActive
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="max-w-4xl mx-auto w-full space-y-6">
        {activeTab === "infos" && (
          <>
            {/* Informations */}
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Informations de l'ECUE</CardTitle>
                <CardDescription>
                  Objet pédagogique réutilisable. Le prix et les UV sont portés par l'UE.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Code" value={<span className="font-mono">{ecue.code}</span>} />
                  <Field label="Libellé" value={ecue.libelle} />
                  <Field label="Crédits" value={ecue.credits ?? "—"} />
                </div>
                {ecue.description && (
                  <div className="mt-4 space-y-0.5">
                    <p className="text-xs font-medium text-muted-foreground">Description</p>
                    <p className="text-sm whitespace-pre-line">{ecue.description}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {activeTab === "supports" && (
          <SubjectMaterialsPanel subjectId={ecueId} canManage canViewStats />
        )}
      </div>
    </div>
  );
}
