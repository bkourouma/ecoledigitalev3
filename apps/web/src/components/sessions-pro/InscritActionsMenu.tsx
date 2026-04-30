"use client";

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
  Mail,
  CheckCircle,
  XCircle,
  X,
  DollarSign,
} from "lucide-react";
import { EnrollmentDetail } from "@ecoledigitale/contracts/src/sessions-pro";

interface InscritActionsMenuProps {
  enrollment: EnrollmentDetail;
  onViewDetail?: (enrollmentId: string) => void;
  onSendEmail?: (enrollmentId: string) => void;
  onMarkPresent?: (enrollmentId: string) => void;
  onMarkAbsent?: (enrollmentId: string) => void;
  onCancelEnrollment?: (enrollmentId: string) => void;
  onRefund?: (enrollmentId: string) => void;
}

export function InscritActionsMenu({
  enrollment,
  onViewDetail,
  onSendEmail,
  onMarkPresent,
  onMarkAbsent,
  onCancelEnrollment,
  onRefund,
}: InscritActionsMenuProps) {
  const handleViewDetail = () => {
    if (onViewDetail) {
      onViewDetail(enrollment.id);
    } else {
      // TODO: Navigate to enrollment detail page
      console.log("View enrollment detail:", enrollment.id);
    }
  };

  const handleSendEmail = () => {
    if (onSendEmail) {
      onSendEmail(enrollment.id);
    } else {
      // TODO: Open email composer
      console.log("Send email to:", enrollment.apprenant.email);
    }
  };

  const handleMarkPresent = () => {
    if (onMarkPresent) {
      onMarkPresent(enrollment.id);
    } else {
      // TODO: Implement mark present
      console.log("Mark present:", enrollment.id);
    }
  };

  const handleMarkAbsent = () => {
    if (onMarkAbsent) {
      onMarkAbsent(enrollment.id);
    } else {
      // TODO: Implement mark absent
      console.log("Mark absent:", enrollment.id);
    }
  };

  const handleCancelEnrollment = () => {
    if (onCancelEnrollment) {
      onCancelEnrollment(enrollment.id);
    } else {
      // TODO: Implement cancel enrollment with confirmation
      console.log("Cancel enrollment:", enrollment.id);
    }
  };

  const handleRefund = () => {
    if (onRefund) {
      onRefund(enrollment.id);
    } else {
      // TODO: Implement refund with confirmation
      console.log("Refund enrollment:", enrollment.id);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleViewDetail}>
          <Eye className="h-4 w-4 mr-2" />
          Voir détail
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSendEmail}>
          <Mail className="h-4 w-4 mr-2" />
          Envoyer email
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleMarkPresent}>
          <CheckCircle className="h-4 w-4 mr-2" />
          Marquer présent
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleMarkAbsent}>
          <XCircle className="h-4 w-4 mr-2" />
          Marquer absent
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleCancelEnrollment} className="text-destructive">
          <X className="h-4 w-4 mr-2" />
          Annuler inscription
        </DropdownMenuItem>
        {enrollment.statut_paiement === "valide" && (
          <DropdownMenuItem onClick={handleRefund} className="text-destructive">
            <DollarSign className="h-4 w-4 mr-2" />
            Rembourser
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

