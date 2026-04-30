"use client";

import { useState } from "react";
import { Button } from "@ecoledigitale/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreVertical,
  Eye,
  Edit,
  Users,
  Copy,
  Tag,
  Mail,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { SessionListItem } from "@ecoledigitale/contracts/src/sessions-pro";
import { StatusChangeDialog } from "./StatusChangeDialog";

interface SessionActionsMenuProps {
  session: SessionListItem & { notes_internes?: string | null };
  onViewDetails?: (sessionId: string) => void;
  onEdit?: (sessionId: string) => void;
  onViewEnrollments?: (sessionId: string) => void;
  onDuplicate?: (sessionId: string) => void;
  onChangeStatus?: (sessionId: string) => void;
  onContactEnrolled?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
}

export function SessionActionsMenu({
  session,
  onViewDetails,
  onEdit,
  onViewEnrollments,
  onDuplicate,
  onChangeStatus,
  onContactEnrolled,
  onDelete,
}: SessionActionsMenuProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);

  const handleViewDetails = () => {
    if (onViewDetails) {
      onViewDetails(session.id);
    } else {
      // Navigate to admin session detail page (Phase 8)
      router.push(`/formations-professionnelles/admin/sessions/${session.id}/details`);
    }
  };

  const handleEdit = () => {
    if (onEdit) {
      onEdit(session.id);
    } else {
      router.push(`/formations-professionnelles/admin/sessions/${session.id}/modifier`);
    }
  };

  const handleViewEnrollments = () => {
    if (onViewEnrollments) {
      onViewEnrollments(session.id);
    } else {
      router.push(`/formations-professionnelles/admin/sessions/${session.id}/details`);
      // Note: The tab switching will be handled by the page component using URL hash or state
    }
  };

  const handleDuplicate = () => {
    if (onDuplicate) {
      onDuplicate(session.id);
    } else {
      // TODO: Implement duplicate functionality
      console.log("Duplicate session:", session.id);
    }
  };

  const handleChangeStatus = () => {
    if (onChangeStatus) {
      onChangeStatus(session.id);
    } else {
      setStatusDialogOpen(true);
    }
  };

  const handleStatusChangeSuccess = () => {
    // Invalidate relevant queries to refresh data
    queryClient.invalidateQueries({ queryKey: ["sessions-pro"] });
    queryClient.invalidateQueries({ queryKey: ["sessions-pro", "admin-list"] });
    queryClient.invalidateQueries({ queryKey: ["sessions-pro", session.id] });
  };

  const handleContactEnrolled = () => {
    if (onContactEnrolled) {
      onContactEnrolled(session.id);
    } else {
      // TODO: Implement contact enrolled functionality
      console.log("Contact enrolled for session:", session.id);
    }
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete(session.id);
    } else {
      // TODO: Implement delete confirmation dialog
      console.log("Delete session:", session.id);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleViewDetails}>
            <Eye className="h-4 w-4 mr-2" />
            Voir détails
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleEdit}>
            <Edit className="h-4 w-4 mr-2" />
            Modifier
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleViewEnrollments}>
            <Users className="h-4 w-4 mr-2" />
            Voir inscrits
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleDuplicate}>
            <Copy className="h-4 w-4 mr-2" />
            Dupliquer
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleChangeStatus}>
            <Tag className="h-4 w-4 mr-2" />
            Changer statut
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleContactEnrolled}>
            <Mail className="h-4 w-4 mr-2" />
            Contacter inscrits
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleDelete} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <StatusChangeDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        currentStatus={session.statut}
        sessionId={session.id}
        sessionCode={session.code_session}
        onSuccess={handleStatusChangeSuccess}
      />
    </>
  );
}

