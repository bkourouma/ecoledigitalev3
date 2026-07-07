"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import { Loader2, AlertCircle, FileDown, ArrowLeft } from "lucide-react";
import { useBulletin } from "@/lib/hooks/use-professional-bulletins";
import { bulletinPdfObjectUrl, downloadBulletinPdf } from "@/lib/bulletin-pdf";

export default function BulletinDetailPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const studentId = String(params?.studentId ?? "");
  const semestreId = search.get("semestre");

  const { data, isLoading, isError, error } = useBulletin(semestreId, studentId);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let url: string | null = null;

    setPdfUrl(null);
    setGenError(null);

    if (data) {
      bulletinPdfObjectUrl(data)
        .then((u) => {
          if (disposed) {
            URL.revokeObjectURL(u);
            return;
          }
          url = u;
          setPdfUrl(u);
        })
        .catch((e) => setGenError(e?.message ?? "Erreur lors de la génération du PDF."));
    }

    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [data]);

  const centered = (node: React.ReactNode) => (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-6">{node}</div>
  );

  if (!semestreId) {
    return centered(
      <Card className="max-w-md">
        <CardContent className="py-8 text-center text-muted-foreground">
          Semestre non précisé.
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return centered(
      <>
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        <p className="text-muted-foreground">Chargement du bulletin...</p>
      </>
    );
  }

  if (isError) {
    return centered(
      <Card className="max-w-lg border-red-200">
        <CardContent className="flex items-center gap-3 py-8 text-red-700">
          <AlertCircle className="h-6 w-6 shrink-0" />
          <p>{(error as Error)?.message ?? "Impossible de charger le bulletin."}</p>
        </CardContent>
      </Card>
    );
  }

  if (genError) {
    return centered(
      <Card className="max-w-lg border-red-200">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-red-700">
          <AlertCircle className="h-6 w-6 shrink-0" />
          <p>{genError}</p>
          <Button
            onClick={() => data && downloadBulletinPdf(data)}
            className="bg-gradient-to-r from-indigo-500 to-blue-600 text-white"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Télécharger le PDF
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" size="sm" onClick={() => router.push("/professionnel/admin/bulletins")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <Button
          onClick={() => data && downloadBulletinPdf(data)}
          disabled={!data}
          className="bg-gradient-to-r from-indigo-500 to-blue-600 text-white"
        >
          <FileDown className="h-4 w-4 mr-2" />
          Télécharger le PDF
        </Button>
      </div>

      {!pdfUrl ? (
        centered(
          <>
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
            <p className="text-muted-foreground">Génération du document...</p>
          </>
        )
      ) : (
        <Card className="overflow-hidden">
          <iframe
            src={`${pdfUrl}#toolbar=0&navpanes=0`}
            title="Bulletin de l'étudiant"
            className="w-full"
            style={{ height: "85vh", border: "none" }}
          />
        </Card>
      )}
    </div>
  );
}
