"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RSOInstallation } from "@/lib/rso/installations";

interface DeleteInstallationConfirmProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  installation: RSOInstallation | null;
}

export function DeleteInstallationConfirm({ open, onClose, onConfirm, installation }: DeleteInstallationConfirmProps) {
  if (!installation) return null;

  return (
    <AlertDialog open={open} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
          <AlertDialogDescription>
            Êtes-vous sûr de vouloir supprimer l'installation{" "}
            <strong>
              {installation.nom} ({installation.code})
            </strong>{" "}
            ? Cette action est irréversible. Si cette installation est utilisée par des activités ou des utilisateurs, la suppression sera refusée.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-red-600 hover:bg-red-700">
            Supprimer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

