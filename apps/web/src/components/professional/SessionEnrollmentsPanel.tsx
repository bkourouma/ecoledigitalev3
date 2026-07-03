"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
} from "@ecoledigitale/ui";
import { Loader2, Plus } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useAdminEnrollments, useAdminEnrollStudent } from "@/lib/hooks/use-professional-suivi";
import { useStudents } from "@/lib/hooks/use-students";

/**
 * Panneau de gestion des inscriptions d'une session — vue admin.
 * Ajout direct d'un étudiant (sans paiement) + liste des inscrits.
 * Réutilisé dans le détail d'une session et la page Inscriptions.
 */

const ENROLLMENT_STATUT_LABEL: Record<string, string> = {
  en_attente_paiement: "En attente paiement",
  confirmee: "Confirmée",
  terminee: "Terminée",
  annulee: "Annulée",
};

export function SessionEnrollmentsPanel({ sessionId }: { sessionId: string }) {
  const enrollmentsQuery = useAdminEnrollments({ ue_session_id: sessionId, pageSize: 100 });
  const studentsQuery = useStudents({ limit: 1000 } as any);
  const enrollMut = useAdminEnrollStudent();
  const rows: any[] = (enrollmentsQuery.data as any)?.items ?? [];
  const students: any[] = (studentsQuery.data as any)?.data ?? [];

  const [studentId, setStudentId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Étudiants non encore inscrits à cette session.
  const enrolledIds = useMemo(
    () => new Set(rows.filter((r) => r.statut !== "annulee").map((r) => r.student_id)),
    [rows]
  );
  const options = useMemo(
    () =>
      students
        .filter((s) => !enrolledIds.has(s.id))
        .map((s) => {
          const name =
            `${s.user?.firstName ?? ""} ${s.user?.lastName ?? ""}`.trim() || s.user?.email || "—";
          const mat = s.studentNumber || s.establishmentMatricule;
          return { value: s.id, label: `${name}${mat ? ` — ${mat}` : ""}` };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [students, enrolledIds]
  );

  async function handleAdd() {
    if (!studentId) return;
    setError(null);
    try {
      await enrollMut.mutateAsync({ ueSessionId: sessionId, studentId });
      setStudentId("");
      enrollmentsQuery.refetch();
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'inscription de l'étudiant.");
    }
  }

  if (enrollmentsQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Étudiants inscrits</CardTitle>
        <CardDescription>
          {rows.length} inscription{rows.length > 1 ? "s" : ""} pour cette session.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Ajout direct d'un étudiant (admin) */}
        <div className="rounded-lg border bg-gray-50 p-4 space-y-2">
          <p className="text-sm font-medium">Ajouter un étudiant à la session</p>
          <p className="text-xs text-muted-foreground">
            Inscription directe, sans paiement préalable. L'étudiant est confirmé immédiatement ; la
            commande reste « en attente de paiement ».
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <SearchableSelect
                value={studentId}
                onChange={setStudentId}
                placeholder={
                  studentsQuery.isLoading
                    ? "Chargement des étudiants…"
                    : options.length === 0
                    ? "Aucun étudiant disponible"
                    : "Rechercher un étudiant…"
                }
                searchPlaceholder="Nom ou matricule…"
                options={options}
              />
            </div>
            <Button onClick={handleAdd} disabled={!studentId || enrollMut.isPending}>
              {enrollMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Ajouter
            </Button>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun étudiant inscrit pour le moment.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-2">Étudiant</th>
                  <th className="py-2 pr-2">Statut</th>
                  <th className="py-2 pr-2">Référence</th>
                  <th className="py-2 pr-2">Inscrit le</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2 pr-2 font-medium">
                      {e.first_name} {e.last_name}
                    </td>
                    <td className="py-2 pr-2">
                      <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                        {ENROLLMENT_STATUT_LABEL[e.statut] ?? e.statut}
                      </span>
                    </td>
                    <td className="py-2 pr-2 font-mono text-xs">{e.order_reference}</td>
                    <td className="py-2 pr-2 text-xs">
                      {new Date(e.created_at).toLocaleDateString("fr-FR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
