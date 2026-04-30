"use client";

import { Card, CardContent } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { FileText } from "lucide-react";
import { useDeleteSupport } from "@/lib/hooks/use-formateur-supports";
import { MaterialCard } from "./MaterialCard";

interface Support {
  id: string;
  titre: string;
  description?: string;
  type_fichier: string;
  taille_fichier: number;
  fichier_url: string;
  formation?: {
    id: string;
    titre: string;
  };
  sessions: Array<{
    id: string;
    code_session: string;
  }>;
  visible_apprenants: boolean;
  nb_telechargements: number;
  created_at: string;
}

interface FormateurSupportsListProps {
  supports: Support[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function FormateurSupportsList({
  supports,
  pagination,
  onPageChange,
  onPageSizeChange,
}: FormateurSupportsListProps) {
  const deleteSupport = useDeleteSupport();

  const handleDelete = (supportId: string) => {
    if (confirm("Êtes-vous sûr de vouloir supprimer ce support de cours ?")) {
      deleteSupport.mutate(supportId);
    }
  };

  if (supports.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Aucun support de cours trouvé</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Supports Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {supports.map((support) => (
          <MaterialCard
            key={support.id}
            support={support}
            onDelete={handleDelete}
            isDeleting={deleteSupport.isPending}
          />
        ))}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Page {pagination.page} sur {pagination.totalPages} ({pagination.total} support(s))
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                >
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPageChange(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                >
                  Suivant
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
