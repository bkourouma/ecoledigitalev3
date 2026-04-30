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
import { RSOActivity } from "@/lib/rso/activities";

interface DeleteActivityConfirmProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  activity: RSOActivity | null;
}

export function DeleteActivityConfirm({ open, onClose, onConfirm, activity }: DeleteActivityConfirmProps) {
  if (!activity) return null;

  return (
    <AlertDialog open={open} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
          <AlertDialogDescription>
            Êtes-vous sûr de vouloir supprimer l'activité{" "}
            <strong>{activity.titre}</strong> ?
            Cette action est irréversible et supprimera toutes les données
            associées à cette activité.
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

