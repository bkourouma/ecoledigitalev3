"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@ecoledigitale/ui";
import { Loader2, Megaphone, Pencil } from "lucide-react";
import {
  ProvenanceFields,
  draftFromRow,
  draftToInput,
  emptyProvenanceDraft,
  type ProvenanceDraft,
} from "./ProvenanceFields";
import {
  useCommerciaux,
  useCreateCommercial,
  useSetProvenance,
  useStudentProvenance,
} from "@/lib/hooks/use-prospection";
import { useStudents } from "@/lib/hooks/use-students";
import { PROVENANCE_CANAL_LABELS } from "@ecoledigitale/contracts";

/**
 * Provenance d'un étudiant, sur sa fiche.
 *
 * C'est ici que vit la provenance de TOUS les étudiants, quel que soit le
 * canal. L'écran Prospection, lui, ne retient que les étudiants amenés par un
 * commercial — les seuls qui ouvrent droit à une commission.
 */

function studentLabel(s: any): string {
  return (
    `${s.user?.firstName ?? ""} ${s.user?.lastName ?? ""}`.trim() || s.user?.email || "Étudiant"
  );
}

export function ProvenanceEtudiantCard({ studentId }: { studentId: string }) {
  const provenanceQuery = useStudentProvenance(studentId);
  const commerciauxQuery = useCommerciaux();
  const studentsQuery = useStudents({ limit: 1000 } as any);
  const createCommercial = useCreateCommercial();
  const setProvenance = useSetProvenance();

  const [ouvert, setOuvert] = useState(false);
  const [draft, setDraft] = useState<ProvenanceDraft>(emptyProvenanceDraft());
  const [erreur, setErreur] = useState<string | null>(null);

  const row = provenanceQuery.data ?? null;
  const renseignee = Boolean(row?.canal);

  const studentOptions = ((studentsQuery.data as any)?.data ?? []).map((s: any) => ({
    id: s.id,
    nom: studentLabel(s),
  }));

  /** Qui a référé l'étudiant, selon le canal. */
  const referent = (() => {
    if (!row) return null;
    switch (row.canal) {
      case "commercial":
        return row.commercial_nom;
      case "connaissance":
        return row.referent_nom;
      case "etudiant":
        return row.referent_student_nom;
      default:
        return row.media_detail;
    }
  })();

  function ouvrir() {
    setErreur(null);
    setDraft(row ? draftFromRow(row) : emptyProvenanceDraft());
    setOuvert(true);
  }

  async function enregistrer() {
    const parsed = draftToInput(draft);
    if (!parsed.ok) return setErreur(parsed.message);
    setErreur(null);
    try {
      await setProvenance.mutateAsync({ studentId, provenance: parsed.value });
      setOuvert(false);
    } catch (error: any) {
      setErreur(error?.message ?? "Enregistrement impossible.");
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            Provenance
          </CardTitle>
          <Button variant="outline" size="sm" onClick={ouvrir}>
            <Pencil className="mr-2 h-4 w-4" />
            {renseignee ? "Modifier" : "Renseigner"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {provenanceQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Chargement…
            </p>
          ) : !renseignee ? (
            <p className="text-sm text-muted-foreground">
              Non renseignée — on ne sait pas comment cet étudiant nous a connus.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Canal</p>
                {/* `div` et non `p` : `Badge` rend un `div`, qu'un paragraphe
                    ne peut pas contenir. Le navigateur refermait le `<p>` avant
                    lui, l'arbre rendu ne correspondait plus à celui de React et
                    l'hydratation échouait. */}
                <div>
                  <Badge variant={row!.canal === "commercial" ? "default" : "secondary"}>
                    {PROVENANCE_CANAL_LABELS[row!.canal!]}
                  </Badge>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {row!.canal === "commercial" ? "Commercial" : "Référent"}
                </p>
                <p>{referent || "—"}</p>
              </div>
              {row!.canal === "commercial" && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Taux de commission</p>
                  <p>{row!.taux_commission ?? "—"} %</p>
                </div>
              )}
              {row!.note && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Commentaire</p>
                  <p>{row!.note}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Provenance de l&apos;étudiant</DialogTitle>
          </DialogHeader>
          {erreur && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {erreur}
            </div>
          )}
          <ProvenanceFields
            draft={draft}
            onChange={setDraft}
            commerciaux={commerciauxQuery.data ?? []}
            onCreateCommercial={(nom, taux) =>
              createCommercial.mutateAsync({ nom, taux_commission: taux })
            }
            students={studentOptions}
            excludeStudentId={studentId}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOuvert(false)}>
              Annuler
            </Button>
            <Button onClick={() => void enregistrer()} disabled={setProvenance.isPending}>
              {setProvenance.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enregistrer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
