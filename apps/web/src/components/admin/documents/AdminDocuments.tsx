/**
 * AdminDocuments Component
 * 
 * Main component for document management with tabs, filters, and document list
 */

"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ecoledigitale/ui";
import { Plus, FileText } from "lucide-react";
import { DocumentsTable } from "./DocumentsTable";
import { DocumentGenerationModal } from "./DocumentGenerationModal";
import { BatchGenerationModal } from "./BatchGenerationModal";
import { useDocumentsList } from "@/lib/hooks/use-documents";
import { DocumentType } from "@ecoledigitale/contracts/src/documents";
import { Card, CardContent } from "@ecoledigitale/ui";
import { Loader2 } from "lucide-react";

export function AdminDocuments() {
  const [activeTab, setActiveTab] = useState<DocumentType | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [generationModalOpen, setGenerationModalOpen] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);

  const { data, isLoading, error } = useDocumentsList({
    type: activeTab === "all" ? undefined : activeTab,
    search: search || undefined,
    page,
    limit: 20,
  });

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  if (isLoading && !data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="ml-3 text-foreground/80">Chargement des documents...</span>
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

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold whitespace-nowrap text-2xl leading-tight md:text-3xl">Gestion des Documents</h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Générez et gérez les documents administratifs
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setGenerationModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Générer un document
          </Button>
          <Button variant="outline" onClick={() => setBatchModalOpen(true)}>
            <FileText className="h-4 w-4 mr-2" />
            Génération en masse
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <Input
          placeholder="Rechercher par numéro, participant, session..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-sm"
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => {
        setActiveTab(value as DocumentType | "all");
        setPage(1);
      }}>
        <TabsList>
          <TabsTrigger value="all">Tous</TabsTrigger>
          <TabsTrigger value="convention">Conventions</TabsTrigger>
          <TabsTrigger value="attestation_presence">Attestations Présence</TabsTrigger>
          <TabsTrigger value="attestation_reussite">Attestations Réussite</TabsTrigger>
          <TabsTrigger value="devis">Devis</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          <DocumentsTable
            documents={data?.documents || []}
            currentPage={data?.page || 1}
            totalPages={data?.totalPages || 0}
            total={data?.total || 0}
            onPageChange={handlePageChange}
          />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <DocumentGenerationModal
        open={generationModalOpen}
        onOpenChange={setGenerationModalOpen}
      />
      <BatchGenerationModal
        open={batchModalOpen}
        onOpenChange={setBatchModalOpen}
      />
    </div>
  );
}

