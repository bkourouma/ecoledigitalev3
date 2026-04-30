"use client";

import { Button } from "@ecoledigitale/ui";
import { Download, Tag, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface BulkActionsBarProps {
  selectedCount: number;
  onExport?: () => void;
  onChangeStatus?: () => void;
  onDelete?: () => void;
  onDeselectAll?: () => void;
  className?: string;
}

export function BulkActionsBar({
  selectedCount,
  onExport,
  onChangeStatus,
  onDelete,
  onDeselectAll,
  className,
}: BulkActionsBarProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between p-4 bg-primary/10 border border-primary/20 rounded-lg",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {selectedCount} session{selectedCount > 1 ? "s" : ""} sélectionnée
          {selectedCount > 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {onExport && (
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="w-4 h-4 mr-2" />
            Exporter la sélection
          </Button>
        )}
        {onChangeStatus && (
          <Button variant="outline" size="sm" onClick={onChangeStatus}>
            <Tag className="w-4 h-4 mr-2" />
            Changer statut
          </Button>
        )}
        {onDelete && (
          <Button variant="outline" size="sm" onClick={onDelete} className="text-destructive">
            <Trash2 className="w-4 h-4 mr-2" />
            Supprimer
          </Button>
        )}
        {onDeselectAll && (
          <Button variant="ghost" size="sm" onClick={onDeselectAll}>
            <X className="w-4 h-4 mr-2" />
            Désélectionner
          </Button>
        )}
      </div>
    </div>
  );
}

