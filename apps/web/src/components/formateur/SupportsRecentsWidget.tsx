"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { FileText, Download, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { SupportListItem } from "@ecoledigitale/contracts/src/formateurs";

interface SupportsRecentsWidgetProps {
  supports: SupportListItem[];
}

export function SupportsRecentsWidget({ supports }: SupportsRecentsWidgetProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Supports récents
        </CardTitle>
      </CardHeader>
      <CardContent>
        {supports.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucun support de cours uploadé</p>
        ) : (
          <div className="space-y-3">
            {supports.map((support) => (
              <Link
                key={support.id}
                href={`/formateur/supports/${support.id}/edit`}
                className="block p-3 rounded-lg border hover:bg-accent transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-medium text-sm">{support.titre}</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      {support.type_fichier} • {(support.taille_fichier / 1024 / 1024).toFixed(2)} MB
                    </p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <Download className="h-3 w-3" />
                      <span>{support.nb_telechargements} téléchargement(s)</span>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground ml-2" />
                </div>
              </Link>
            ))}
          </div>
        )}
        {supports.length > 0 && (
          <Link
            href="/formateur/supports"
            className="mt-4 block text-sm text-primary hover:underline text-center"
          >
            Voir tous les supports →
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

