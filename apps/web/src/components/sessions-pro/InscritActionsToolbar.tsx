"use client";

import { Button } from "@ecoledigitale/ui";
import { Download, Mail } from "lucide-react";

interface InscritActionsToolbarProps {
  onExport?: () => void;
  onSendGroupEmail?: () => void;
  selectedCount?: number;
  disabled?: boolean;
}

export function InscritActionsToolbar({
  onExport,
  onSendGroupEmail,
  selectedCount = 0,
  disabled = false,
}: InscritActionsToolbarProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="text-sm text-muted-foreground">
        {selectedCount > 0 && (
          <span>{selectedCount} inscription{selectedCount > 1 ? "s" : ""} sélectionnée{selectedCount > 1 ? "s" : ""}</span>
        )}
      </div>
      <div className="flex gap-2">
        {onExport && (
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={disabled}
          >
            <Download className="w-4 h-4 mr-2" />
            Exporter Excel
          </Button>
        )}
        {onSendGroupEmail && (
          <Button
            variant="outline"
            size="sm"
            onClick={onSendGroupEmail}
            disabled={disabled || selectedCount === 0}
          >
            <Mail className="w-4 h-4 mr-2" />
            Email groupé
          </Button>
        )}
      </div>
    </div>
  );
}

