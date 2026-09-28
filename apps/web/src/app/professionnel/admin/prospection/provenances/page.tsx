"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from "@ecoledigitale/ui";
import { AlertTriangle, Compass, Loader2, Pencil, Search, Trash2, Users } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ExportButtons } from "@/components/ExportButtons";
import { openProvenancesPdf } from "@/lib/utils/provenances-report";
import {
  ProvenanceFields,
  draftFromRow,
  draftToInput,
  emptyProvenanceDraft,
  type ProvenanceDraft,
} from "@/components/prospection/ProvenanceFields";
import {
  useCommerciaux,
  useCreateCommercial,
  useDeleteProvenance,
  useProvenances,
  useSetProvenance,
} from "@/lib/hooks/use-prospection";
import { useStudents } from "@/lib/hooks/use-students";
import type { ProvenanceRowDto } from "@ecoledigitale/contracts";
import { formatAmountFCFA } from "@/lib/utils";

/**
 * Étudiants amenés par un commercial IPAM.
 *
 * Cet écran ne liste QUE le canal « commercial » : c'est le seul qui engage de
 * l'argent, et c'est ce qu'on vient y chercher. La provenance des autres
 * étudiants — Google, Facebook, une connaissance… — est suivie elle aussi,
 * mais sur la fiche de chaque étudiant (/academic/students/<id>), pas ici.
 *
 * La liste part donc vide et se remplit au fil des inscriptions passées par un
 * commercial.
 */

const TOUS = "__tous__";

function studentLabel(s: any): string {
  return (
    `${s.user?.firstName ?? ""} ${s.user?.lastName ?? ""}`.trim() || s.user?.email || "Étudiant"
  );
}

export default function ProvenancesPage() {
  const [search, setSearch] = useState("");
  const [commercialId, setCommercialId] = useState(TOUS);
  const [edition, setEdition] = useState<ProvenanceRowDto | null>(null);
  const [draft, setDraft] = useState<ProvenanceDraft>(emptyProvenanceDraft());
  const [erreur, setErreur] = useState<string | null>(null);
  const [exportErreur, setExportErreur] = useState<string | null>(null);

  const provenancesQuery = useProvenances({
    search: search.trim() || undefined,
    // Jamais modifiable : la page n'existe que pour ce canal.
    canal: "commercial",
    commercial_id: commercialId === TOUS ? undefined : commercialId,
    limit: 500,
  });
  const commerciauxQuery = useCommerciaux();
  const studentsQuery = useStudents({ limit: 1000 } as any);
  const createCommercial = useCreateCommercial();
  const setProvenance = useSetProvenance();
  const deleteProvenance = useDeleteProvenance();

  const rows: ProvenanceRowDto[] = provenancesQuery.data?.items ?? [];
  const commerciaux = commerciauxQuery.data ?? [];
  const studentOptions = useMemo(
    () =>
      ((studentsQuery.data as any)?.data ?? []).map((s: any) => ({
        id: s.id,
        nom: studentLabel(s),
      })),
    [studentsQuery.data]
  );

  const commercialOptions = [
    { value: TOUS, label: "Tous les commerciaux" },
    ...commerciaux.map((c) => ({ value: c.id, label: c.nom })),
  ];

  const stats = useMemo(() => {
    const scolarite = rows.reduce((sum, r) => sum + r.total_paye, 0);
    const commission = rows.reduce((sum, r) => sum + r.commission, 0);
    return { total: rows.length, scolarite, commission };
  }, [rows]);

  function ouvrirEdition(row: ProvenanceRowDto) {
    setErreur(null);
    setEdition(row);
    setDraft(draftFromRow(row));
  }

  async function enregistrer() {
    if (!edition) return;
    const parsed = draftToInput(draft);
    if (!parsed.ok) return setErreur(parsed.message);
    setErreur(null);
    try {
      await setProvenance.mutateAsync({
        studentId: edition.student_id,
        provenance: parsed.value,
      });
      setEdition(null);
    } catch (error: any) {
      setErreur(error?.message ?? "Enregistrement impossible.");
    }
  }

  async function retirer(row: ProvenanceRowDto) {
    if (!window.confirm(`Retirer la provenance de ${row.student_nom} ?`)) return;
    try {
      await deleteProvenance.mutateAsync(row.student_id);
    } catch (error: any) {
      window.alert(error?.message ?? "Suppression impossible.");
    }
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
            <Compass className="h-7 w-7 text-indigo-500" />
            Étudiants amenés par un commercial
          </h1>
        </div>
        <div className="flex gap-2 shrink-0">
          {/* Le PDF porte exactement les lignes affichées, filtres compris. */}
          <ExportButtons
            formats={["pdf"]}
            disabled={provenancesQuery.isLoading || rows.length === 0}
            onExportPdf={(win) =>
              openProvenancesPdf(
                rows,
                {
                  commercial:
                    commercialId === TOUS
                      ? "Tous les commerciaux"
                      : (commerciaux.find((c) => c.id === commercialId)?.nom ?? "—"),
                  recherche: search.trim() || undefined,
                },
                win
              )
            }
            onError={setExportErreur}
          />
        </div>
      </div>

      {exportErreur && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {exportErreur}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Étudiants amenés
            </p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Scolarité encaissée
            </p>
            <p className="text-2xl font-bold">
              {formatAmountFCFA(Math.round(stats.scolarite))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Commission acquise
            </p>
            <p className="text-2xl font-bold text-indigo-600">
              {formatAmountFCFA(Math.round(stats.commission))}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-lg">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Liste
          </CardTitle>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nom ou matricule…"
                className="pl-9 sm:w-64"
              />
            </div>
            <div className="sm:w-56">
              <SearchableSelect
                value={commercialId}
                onChange={setCommercialId}
                options={commercialOptions}
                placeholder="Commercial"
                searchPlaceholder="Rechercher un commercial…"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {provenancesQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
              Chargement…
            </p>
          ) : provenancesQuery.isError ? (
            <p className="py-8 text-center text-sm text-red-600">
              <AlertTriangle className="h-4 w-4 inline mr-2" />
              {(provenancesQuery.error as Error)?.message ?? "Chargement impossible."}
            </p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {commercialId === TOUS && search.trim() === "" ? (
                <>
                  Aucun étudiant n&apos;a encore été amené par un commercial. Le commercial se
                  désigne au moment d&apos;inscrire, depuis la page{" "}
                  <Link
                    href="/professionnel/admin/inscriptions"
                    className="text-indigo-600 hover:underline"
                  >
                    Inscriptions
                  </Link>
                  .
                </>
              ) : (
                "Aucun étudiant ne correspond à ces filtres."
              )}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Étudiant</th>
                    <th className="py-2 pr-3">Matricule</th>
                    <th className="py-2 pr-3">Commercial</th>
                    <th className="py-2 pr-3 text-right">Taux</th>
                    <th className="py-2 pr-3 text-right">Scolarité encaissée</th>
                    <th className="py-2 pr-3 text-right">Commission</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row) => (
                    <tr key={row.student_id} className="hover:bg-accent/40">
                      <td className="py-2 pr-3 font-medium">{row.student_nom}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                        {row.matricule ?? "—"}
                      </td>
                      <td className="py-2 pr-3">{row.commercial_nom ?? "—"}</td>
                      <td className="py-2 pr-3 text-right">
                        {row.taux_commission == null ? "—" : `${row.taux_commission} %`}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatAmountFCFA(Math.round(row.total_paye))}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold text-indigo-600">
                        {row.commission > 0 ? formatAmountFCFA(row.commission) : "—"}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => ouvrirEdition(row)}
                          title="Modifier la provenance"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void retirer(row)}
                          title="Retirer la provenance"
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={edition !== null} onOpenChange={(open) => !open && setEdition(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Provenance — {edition?.student_nom}</DialogTitle>
          </DialogHeader>
          {erreur && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {erreur}
            </div>
          )}
          <ProvenanceFields
            draft={draft}
            onChange={setDraft}
            commerciaux={commerciaux}
            onCreateCommercial={(nom, taux) =>
              createCommercial.mutateAsync({ nom, taux_commission: taux })
            }
            students={studentOptions}
            excludeStudentId={edition?.student_id}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEdition(null)}>
              Annuler
            </Button>
            <Button onClick={() => void enregistrer()} disabled={setProvenance.isPending}>
              {setProvenance.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Enregistrer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
