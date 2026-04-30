"use client";

import { Button } from "@ecoledigitale/ui";
import { Download, FileSpreadsheet, FileText } from "lucide-react";

interface ExportButtonsProps {
  onExport: (format: 'excel' | 'pdf') => void;
  className?: string;
}

export function ExportButtons({ onExport, className }: ExportButtonsProps) {
  return (
    <div className={`flex gap-2 ${className || ""}`}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onExport('excel')}
        title="Exporter en Excel"
      >
        <FileSpreadsheet className="mr-2 h-4 w-4" />
        Excel
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onExport('pdf')}
        title="Exporter en PDF"
      >
        <FileText className="mr-2 h-4 w-4" />
        PDF
      </Button>
    </div>
  );
}

