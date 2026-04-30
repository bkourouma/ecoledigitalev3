"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ecoledigitale/ui";
import { EnrollmentDetail } from "@ecoledigitale/contracts/src/sessions-pro";
import { InscritActionsMenu } from "./InscritActionsMenu";
import { Badge } from "@ecoledigitale/ui";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface InscritTableProps {
  enrollments: EnrollmentDetail[];
  onEnrollmentAction?: (action: string, enrollmentId: string) => void;
}

const statusLabels: Record<string, string> = {
  confirmee: "Confirmée",
  en_attente: "En attente",
  annulee: "Annulée",
};

const paymentStatusLabels: Record<string, string> = {
  valide: "Payé",
  en_attente: "En attente",
  echec: "Échec",
};

const statusColors: Record<string, string> = {
  confirmee: "bg-green-500/10 text-green-600 dark:text-green-400",
  en_attente: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  annulee: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const paymentStatusColors: Record<string, string> = {
  valide: "bg-green-500/10 text-green-600 dark:text-green-400",
  en_attente: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  echec: "bg-red-500/10 text-red-600 dark:text-red-400",
};

export function InscritTable({ enrollments, onEnrollmentAction }: InscritTableProps) {
  if (enrollments.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>Aucune inscription trouvée</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Participant</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Entreprise</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Paiement</TableHead>
            <TableHead>Date inscription</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {enrollments.map((enrollment) => (
            <TableRow key={enrollment.id}>
              <TableCell>
                <div>
                  <div className="font-medium">
                    {enrollment.apprenant.prenom} {enrollment.apprenant.nom}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {enrollment.apprenant.email}
                  </div>
                  {enrollment.apprenant.telephone && (
                    <div className="text-sm text-muted-foreground">
                      {enrollment.apprenant.telephone}
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  {enrollment.type_inscription === "individuelle" ? "Individuelle" : "Entreprise"}
                </Badge>
              </TableCell>
              <TableCell>
                {enrollment.entreprise ? (
                  <span className="text-sm">{enrollment.entreprise.nom}</span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <Badge className={statusColors[enrollment.statut]}>
                  {statusLabels[enrollment.statut]}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge className={paymentStatusColors[enrollment.statut_paiement]}>
                  {paymentStatusLabels[enrollment.statut_paiement]}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="text-sm">
                  {format(new Date(enrollment.date_inscription), "dd/MM/yyyy HH:mm", { locale: fr })}
                </span>
              </TableCell>
              <TableCell>
                <InscritActionsMenu
                  enrollment={enrollment}
                  onViewDetail={(id) => onEnrollmentAction?.("view", id)}
                  onSendEmail={(id) => onEnrollmentAction?.("email", id)}
                  onMarkPresent={(id) => onEnrollmentAction?.("present", id)}
                  onMarkAbsent={(id) => onEnrollmentAction?.("absent", id)}
                  onCancelEnrollment={(id) => onEnrollmentAction?.("cancel", id)}
                  onRefund={(id) => onEnrollmentAction?.("refund", id)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

