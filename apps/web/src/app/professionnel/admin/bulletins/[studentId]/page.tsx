"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, Button } from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, AlertCircle, FileDown } from "lucide-react";
import { useBulletin } from "@/lib/hooks/use-professional-bulletins";
import { BulletinView } from "@/components/professional/BulletinView";
import { downloadBulletinPdf } from "@/lib/bulletin-pdf";

export default function BulletinDetailPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const studentId = String(params?.studentId ?? "");
  const semestreId = search.get("semestre");

  const { data, isLoading, isError, error } = useBulletin(semestreId, studentId);

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Button variant="outline" size="sm" onClick={() => router.push("/professionnel/admin/bulletins")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <Button
          onClick={() => data && downloadBulletinPdf(data)}
          disabled={!data}
          className="bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white"
        >
          <FileDown className="h-4 w-4 mr-2" />
          Télécharger (PDF)
        </Button>
      </div>

      {!semestreId ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Semestre non précisé.
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : isError ? (
        <Card className="border-red-200">
          <CardContent className="flex items-center gap-3 py-8 text-red-700">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(error as Error)?.message ?? "Impossible de charger le bulletin."}</p>
          </CardContent>
        </Card>
      ) : (
        <BulletinView bulletin={data} />
      )}
    </div>
  );
}
