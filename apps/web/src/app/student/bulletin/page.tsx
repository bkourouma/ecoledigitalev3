"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import { CalendarRange, Loader2, AlertCircle, FileSpreadsheet, FileDown } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { BulletinView } from "@/components/professional/BulletinView";
import { useMyBulletin, useMyBulletinSemestres } from "@/lib/hooks/use-professional-bulletins";
import { downloadBulletinPdf } from "@/lib/bulletin-pdf";

export default function MyBulletinPage() {
  const [semestreId, setSemestreId] = useState("");
  const semestresQuery = useMyBulletinSemestres();
  const bulletinQuery = useMyBulletin(semestreId || null);

  const semestres: any[] = (semestresQuery.data as any[]) ?? [];

  // Sélectionne le premier semestre par défaut.
  useEffect(() => {
    if (!semestreId && semestres.length > 0) setSemestreId(semestres[0].id);
  }, [semestres, semestreId]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print:hidden">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
            <FileSpreadsheet className="h-7 w-7 text-indigo-500" />
            Mon bulletin
          </h1>
          <p className="text-muted-foreground mt-2">
            Consultez votre relevé de notes par semestre.
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
      ) : (
        <BulletinView bulletin={bulletinQuery.data} />
      )}
    </div>
  );
}
