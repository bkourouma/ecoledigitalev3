"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Input } from "@ecoledigitale/ui";
import { InscritActionsToolbar } from "./InscritActionsToolbar";
import { InscritTable } from "./InscritTable";
import { useSessionEnrollments } from "@/lib/hooks/use-sessions-pro";
import { Loader2, Search } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { EnrollmentDetail } from "@ecoledigitale/contracts/src/sessions-pro";

interface InscritListsTabProps {
  sessionId: string;
  onExport?: () => void;
  onSendGroupEmail?: () => void;
}

export function InscritListsTab({
  sessionId,
  onExport,
  onSendGroupEmail,
}: InscritListsTabProps) {
  const [search, setSearch] = useState("");
  const [statutFilter, setStatutFilter] = useState<string>("all");
  const [paiementFilter, setPaiementFilter] = useState<string>("all");

  // Build query from filters
  const query = {
    search: search || undefined,
    statut: statutFilter !== "all" ? [statutFilter as "confirmee" | "en_attente" | "annulee"] : undefined,
    paiement: paiementFilter !== "all" ? [paiementFilter as "valide" | "en_attente" | "echec"] : undefined,
  };

  const { data, isLoading, error } = useSessionEnrollments(sessionId, query);

  const handleEnrollmentAction = (action: string, enrollmentId: string) => {
    // TODO: Implement actions
    console.log("Action:", action, "Enrollment:", enrollmentId);
  };

  const handleExport = () => {
    if (onExport) {
      onExport();
    } else {
      // TODO: Trigger export
      console.log("Export enrollments");
    }
  };

  const handleSendGroupEmail = () => {
    if (onSendGroupEmail) {
      onSendGroupEmail();
    } else {
      // TODO: Open group email composer
      console.log("Send group email");
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-3 text-foreground/80">Chargement des inscriptions...</span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <p className="text-destructive mb-2">Erreur lors du chargement</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Une erreur inattendue s'est produite"}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const enrollments = data?.data?.inscrits || [];
  const total = data?.data?.total || 0;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filtres</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher par nom ou email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Status filter */}
            <Select value={statutFilter} onValueChange={setStatutFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Statut inscription" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="confirmee">Confirmée</SelectItem>
                <SelectItem value="en_attente">En attente</SelectItem>
                <SelectItem value="annulee">Annulée</SelectItem>
              </SelectContent>
            </Select>

            {/* Payment status filter */}
            <Select value={paiementFilter} onValueChange={setPaiementFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Statut paiement" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="valide">Payé</SelectItem>
                <SelectItem value="en_attente">En attente</SelectItem>
                <SelectItem value="echec">Échec</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Toolbar */}
      <InscritActionsToolbar
        onExport={handleExport}
        onSendGroupEmail={handleSendGroupEmail}
        selectedCount={0} // TODO: Implement selection
      />

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Inscriptions ({total})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InscritTable
            enrollments={enrollments}
            onEnrollmentAction={handleEnrollmentAction}
          />
        </CardContent>
      </Card>
    </div>
  );
}

