"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Checkbox,
} from "@ecoledigitale/ui";
import type { RSOExportOptions, RSOWordExportRequest } from "@ecoledigitale/contracts/rso/medias";

interface ExportOptionsProps {
  open: boolean;
  onClose: () => void;
  onExport: (options: RSOExportOptions) => void;
  onExportWord?: (options: RSOWordExportRequest) => void;
  defaultOptions?: RSOExportOptions;
  exportType?: 'pdf' | 'word';
}

export function ExportOptions({
  open,
  onClose,
  onExport,
  onExportWord,
  defaultOptions = {},
  exportType = 'pdf',
}: ExportOptionsProps) {
  const [formatPage, setFormatPage] = useState<RSOExportOptions["formatPage"]>(
    defaultOptions.formatPage || "A4"
  );
  const [orientation, setOrientation] = useState<RSOExportOptions["orientation"]>(
    defaultOptions.orientation || "portrait"
  );
  const [includeImages, setIncludeImages] = useState(
    defaultOptions.includeImages !== false
  );
  const [includeRecommendations, setIncludeRecommendations] = useState(
    defaultOptions.includeRecommendations !== false
  );
  const [watermark, setWatermark] = useState(defaultOptions.watermark || false);

  const handleExport = () => {
    if (exportType === 'word' && onExportWord) {
      onExportWord({
        includeImages,
        includeRecommendations,
      });
    } else {
      onExport({
        formatPage,
        orientation,
        includeImages,
        includeRecommendations,
        watermark,
      });
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Options d'export {exportType === 'pdf' ? 'PDF' : 'Word'}</DialogTitle>
          <DialogDescription>
            Configurez les options de génération du document
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Format and Orientation (PDF only) */}
          {exportType === 'pdf' && (
            <>
              {/* Format */}
              <div className="space-y-2">
                <Label htmlFor="format">Format de page</Label>
                <Select value={formatPage} onValueChange={(v) => setFormatPage(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A4">A4</SelectItem>
                    <SelectItem value="Letter">Letter</SelectItem>
                    <SelectItem value="Legal">Legal</SelectItem>
                    <SelectItem value="A3">A3</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Orientation */}
              <div className="space-y-2">
                <Label htmlFor="orientation">Orientation</Label>
                <Select value={orientation} onValueChange={(v) => setOrientation(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">Portrait</SelectItem>
                    <SelectItem value="landscape">Paysage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* Include Images */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="includeImages"
              checked={includeImages}
              onCheckedChange={(checked) => setIncludeImages(checked === true)}
            />
            <Label htmlFor="includeImages" className="cursor-pointer">
              Inclure les images de la galerie
            </Label>
          </div>

          {/* Include Recommendations */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="includeRecommendations"
              checked={includeRecommendations}
              onCheckedChange={(checked) => setIncludeRecommendations(checked === true)}
            />
            <Label htmlFor="includeRecommendations" className="cursor-pointer">
              Inclure les recommandations
            </Label>
          </div>

          {/* Watermark (PDF only) */}
          {exportType === 'pdf' && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="watermark"
                checked={watermark}
                onCheckedChange={(checked) => setWatermark(checked === true)}
              />
              <Label htmlFor="watermark" className="cursor-pointer">
                Ajouter un filigrane "CONFIDENTIEL"
              </Label>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button onClick={handleExport}>Exporter</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

