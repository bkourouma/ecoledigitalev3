"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Button } from "@ecoledigitale/ui";
import { RotateCcw, FileSpreadsheet, GraduationCap } from "lucide-react";
import { useMyRattrapages } from "@/lib/hooks/use-professional-bulletins";
import { useCurrentStudent } from "@/lib/hooks/use-student-data";
import { RattrapagesView, type RattrapageRow } from "@/components/RattrapagesView";

/**
 * Mes rattrapages — espace étudiant (Module Professionnel).
 *
 * Pendant de `/professionnel/admin/notes/rattrapages`, en lecture seule et
 * borné à l'étudiant connecté : il voit s'il est convoqué en Session 2 et,
 * le cas échéant, exactement quelles ECUE il doit repasser. Le tableau, les
 * filtres et les états vivent dans `RattrapagesView`, partagé avec l'écran
 * équivalent de l'espace parent.
 */
export default function MesRattrapagesPage() {
  const query = useMyRattrapages();
  const toutes: RattrapageRow[] = (query.data as RattrapageRow[]) ?? [];

  // Nommer l'étudiant concerné, comme sur l'écran parent : une convocation en
  // Session 2 se lit mieux quand le document dit à qui elle s'adresse.
  const { data: session } = useSession();
  const { data: etudiant } = useCurrentStudent();
  const nom =
    `${etudiant?.firstName ?? (session?.user as any)?.firstName ?? ""} ${
      etudiant?.lastName ?? (session?.user as any)?.lastName ?? ""
    }`.trim() || (session?.user as any)?.name || "";

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent flex items-center gap-2">
            <RotateCcw className="h-7 w-7 text-amber-500" />
            Mes rattrapages
          </h1>
          <p className="text-muted-foreground mt-2">
            Les ECUE que vous devez repasser en Session 2.
          </p>
        </div>
        <Link href="/student/documents">
          <Button variant="outline">
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Mes bulletins
          </Button>
        </Link>
      </div>

      {nom && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <GraduationCap className="h-4 w-4 text-amber-500" />
          Rattrapages de <span className="font-semibold text-foreground">{nom}</span>
        </div>
      )}

      <RattrapagesView
        toutes={toutes}
        isLoading={query.isLoading}
        isError={query.isError}
        errorMessage={(query.error as Error)?.message}
        onRetry={() => query.refetch()}
        sujet="moi"
      />
    </div>
  );
}
