"use client";

import { useState } from "react";
import { Card } from "@ecoledigitale/ui";
import { Button } from "@ecoledigitale/ui";
import { AdminSessionCard } from "./AdminSessionCard";
import { BulkActionsBar } from "./BulkActionsBar";
import { SessionListItem } from "@ecoledigitale/contracts/src/sessions-pro";
import { useRouter } from "next/navigation";
import { useDeleteFormationSession } from "@/lib/hooks/use-formations-pro";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

interface AdminSessionsListProps {
  sessions: Array<SessionListItem & { notes_internes?: string | null }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSortChange?: (sort: "date_asc" | "date_desc" | "prix_asc" | "prix_desc") => void;
  currentSort?: "date_asc" | "date_desc" | "prix_asc" | "prix_desc";
  selectedSessions?: string[];
  onSelectionChange?: (sessionIds: string[]) => void;
  onExport?: () => void;
  onBulkStatusChange?: () => void;
  onBulkDelete?: () => void;
  className?: string;
}

export function AdminSessionsList({
  sessions,
  pagination,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  currentSort,
  selectedSessions = [],
  onSelectionChange,
  onExport,
  onBulkStatusChange,
  onBulkDelete,
}: AdminSessionsListProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const deleteSessionMutation = useDeleteFormationSession();

  const handleView = (sessionId: string) => {
    router.push(`/formations-professionnelles/admin/sessions/${sessionId}/details`);
  };

  const handleEdit = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    const formationSlug = session?.formation?.slug;
    if (formationSlug) {
      router.push(`/formations-professionnelles/catalogue/${formationSlug}/sessions/${sessionId}/edit`);
    }
  };

  const handleDelete = async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    if (!confirm(`Êtes-vous sûr de vouloir supprimer la session ${session.code_session} ?`)) {
      return;
    }

    try {
      const formationId = session.formation?.id;
      if (!formationId) {
        toast.error("Impossible de supprimer : ID de formation manquant");
        return;
      }

      await deleteSessionMutation.mutateAsync({
        formationId,
        sessionId,
      });
      toast.success("Session supprimée avec succès");
      // Refresh the list by invalidating queries
      queryClient.invalidateQueries({ queryKey: ["sessions-pro", "admin-list"] });
      queryClient.invalidateQueries({ queryKey: ["sessions-pro"] });
    } catch (error: any) {
      toast.error(error.message || "Erreur lors de la suppression de la session");
    }
  };

  return (
    <div className="space-y-4 min-w-0 w-full">
      {/* Bulk Actions Bar */}
      {selectedSessions.length > 0 && (
        <BulkActionsBar
          selectedCount={selectedSessions.length}
          onExport={onExport}
          onChangeStatus={onBulkStatusChange}
          onDelete={onBulkDelete}
          onDeselectAll={() => onSelectionChange?.([])}
        />
      )}

      {/* Sessions Grid */}
      {sessions.length === 0 ? (
        <Card>
          <div className="text-center py-12 text-muted-foreground">
            Aucune session trouvée
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sessions.map((session) => (
            <AdminSessionCard
              key={session.id}
              session={session}
              onView={handleView}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 px-2 sm:px-0 py-2 min-w-0 w-full">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap">Lignes par page:</span>
          <select
            value={pagination.limit}
            onChange={(e) => onPageSizeChange(parseInt(e.target.value))}
            className="h-8 sm:h-9 rounded-md border border-input bg-background px-2 sm:px-3 py-1 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-2">
          <span className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left whitespace-nowrap">
            Page {pagination.page} sur {pagination.totalPages} <span className="hidden sm:inline">({pagination.total} sessions)</span>
          </span>
          <div className="flex gap-1 justify-center sm:justify-start">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="text-xs sm:text-sm px-3 sm:px-4 min-w-[80px] sm:min-w-auto"
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="text-xs sm:text-sm px-3 sm:px-4 min-w-[80px] sm:min-w-auto"
            >
              Suivant
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

