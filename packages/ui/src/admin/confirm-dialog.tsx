"use client";

import * as React from "react";
import { Button } from "../button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel?: string;
  onConfirm: () => void;
  /** Action en cours : désactive les boutons. */
  pending?: boolean;
  destructive?: boolean;
  /** Contenu complémentaire (ex. champ « motif » obligatoire). */
  children?: React.ReactNode;
  /** Désactive la confirmation tant que le contenu n'est pas valide. */
  confirmDisabled?: boolean;
}

/** Confirmation d'une action sensible (suspension, suppression…) — focus piégé, Échap pour annuler (Radix). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  closeLabel,
  onConfirm,
  pending,
  destructive,
  children,
  confirmDisabled,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={closeLabel} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? title}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-10" disabled={pending} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            className="min-h-11 sm:min-h-10"
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
