"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import {
  CalendarRange,
  Loader2,
  AlertCircle,
  FileSpreadsheet,
  FileDown,
  ExternalLink,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useMyBulletin, useMyBulletinSemestres } from "@/lib/hooks/use-professional-bulletins";
import {
  downloadBulletinPdf,
  openAllBulletinsPdf,
  bulletinPdfObjectUrl,
} from "@/lib/bulletin-pdf";

/**
 * Mon bulletin — espace étudiant.
 * Affiche le RELEVÉ OFFICIEL en PDF (identique à celui de l'admin dans
 * /professionnel/admin/bulletins), généré par `bulletin-pdf.ts`. L'aperçu est
 * le document PDF lui-même (iframe), et non un rendu HTML distinct.
 */
export default function MyBulletinPage() {
  const [semestreId, setSemestreId] = useState("");
  const semestresQuery = useMyBulletinSemestres();
  const bulletinQuery = useMyBulletin(semestreId || null);

  const semestres: any[] = (semestresQuery.data as any[]) ?? [];

  // Sélectionne le premier semestre par défaut.
  useEffect(() => {
    if (!semestreId && semestres.length > 0) setSemestreId(semestres[0].id);
  }, [semestres, semestreId]);

  // Aperçu PDF officiel (même document que le PDF téléchargé / celui de l'admin).
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let url: string | null = null;
    setPdfUrl(null);
    setPdfError(null);
    if (bulletinQuery.data) {
      bulletinPdfObjectUrl(bulletinQuery.data)
        .then((u) => {
          if (revoked) {
            URL.revokeObjectURL(u);
            return;
          }
          url = u;
          setPdfUrl(u);
        })
        .catch((e) => setPdfError(e?.message ?? "Erreur lors de la génération du PDF."));
    }
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [bulletinQuery.data]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
            <FileSpreadsheet className="h-7 w-7 text-indigo-500" />
            Mon bulletin
          </h1>
          <p className="text-muted-foreground mt-2">
            Votre relevé de notes officiel par semestre.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="w-56">
            <SearchableSelect
              value={semestreId}
              onChange={setSemestreId}
              icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
              placeholder={
                semestresQuery.isLoading
                  ? "Chargement…"
                  : semestres.length === 0
                  ? "Aucun semestre"
                  : "Semestre"
              }
              options={semestres.map((s) => ({
                value: s.id,
                label: `${s.libelle}${s.filiere_code ? ` · ${s.filiere_code}` : ""}`,
              }))}
            />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              if (!bulletinQuery.data) return;
              const w = window.open("about:blank", "_blank");
              openAllBulletinsPdf([bulletinQuery.data], w);
            }}
            disabled={!bulletinQuery.data}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Ouvrir
          </Button>
          <Button
            onClick={() => bulletinQuery.data && downloadBulletinPdf(bulletinQuery.data)}
            disabled={!bulletinQuery.data}
            className="bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Télécharger (PDF)
          </Button>
        </div>
      </div>

      {semestresQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : semestres.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Vous n'êtes inscrit à aucun semestre pour le moment.
          </CardContent>
        </Card>
      ) : bulletinQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : bulletinQuery.isError ? (
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(bulletinQuery.error as Error)?.message ?? "Impossible de charger le bulletin."}</p>
          </CardContent>
        </Card>
      ) : pdfError ? (
        <Card className="border-red-200">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{pdfError}</p>
            <Button
              onClick={() => bulletinQuery.data && downloadBulletinPdf(bulletinQuery.data)}
              className="bg-gradient-to-r from-indigo-500 to-blue-600 text-white"
            >
              <FileDown className="h-4 w-4 mr-2" />
              Télécharger le PDF
            </Button>
          </CardContent>
        </Card>
      ) : !pdfUrl ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
          <p className="text-muted-foreground">Génération du relevé…</p>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <iframe
            src={pdfUrl}
            title="Relevé de notes"
            className="w-full"
            style={{ height: "85vh", border: "none" }}
          />
        </Card>
      )}
    </div>
  );
}
