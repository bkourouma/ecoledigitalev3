"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { Megaphone } from "lucide-react";
import {
  ProvenanceFields,
  draftToInput,
  emptyProvenanceDraft,
  type ProvenanceDraft,
  type StudentOption,
} from "./ProvenanceFields";
import type { CommercialDto, ProvenanceInput } from "@ecoledigitale/contracts";

/**
 * Saisie de la provenance au moment d'inscrire plusieurs étudiants.
 *
 * Deux modes, parce que les deux cas se présentent vraiment : une promotion
 * entière ramenée par le même commercial (« la même pour tous »), et un lot
 * composite où chacun est arrivé par un chemin différent (« une par étudiant »).
 */

export type ProvenanceLotState = {
  mode: "commune" | "individuelle";
  commune: ProvenanceDraft;
  parEtudiant: Record<string, ProvenanceDraft>;
};

export function emptyProvenanceLot(): ProvenanceLotState {
  return { mode: "commune", commune: emptyProvenanceDraft(), parEtudiant: {} };
}

export type LotEntree = { student_id: string; provenance: ProvenanceInput };

/**
 * Traduit la saisie en entrées d'API. Un étudiant dont la provenance n'est pas
 * renseignée est simplement ignoré : la provenance reste facultative à
 * l'inscription et se complète plus tard.
 */
export function lotToEntrees(
  state: ProvenanceLotState,
  studentIds: string[]
): { entrees: LotEntree[] } | { erreur: string } {
  if (state.mode === "commune") {
    if (!state.commune.canal) return { entrees: [] };
    const parsed = draftToInput(state.commune);
    if (!parsed.ok) return { erreur: parsed.message };
    return { entrees: studentIds.map((id) => ({ student_id: id, provenance: parsed.value })) };
  }

  const entrees: LotEntree[] = [];
  for (const id of studentIds) {
    const draft = state.parEtudiant[id];
    if (!draft?.canal) continue;
    const parsed = draftToInput(draft);
    if (!parsed.ok) return { erreur: parsed.message };
    entrees.push({ student_id: id, provenance: parsed.value });
  }
  return { entrees };
}

type ProvenanceEnLotProps = {
  value: ProvenanceLotState;
  onChange: (value: ProvenanceLotState) => void;
  /** Étudiants sélectionnés pour l'inscription, dans l'ordre d'affichage. */
  selection: StudentOption[];
  /** Tous les étudiants, pour le canal « Un étudiant » (référent). */
  students: StudentOption[];
  commerciaux: CommercialDto[];
  onCreateCommercial: (nom: string, taux: number) => Promise<CommercialDto>;
};

export function ProvenanceEnLot({
  value,
  onChange,
  selection,
  students,
  commerciaux,
  onCreateCommercial,
}: ProvenanceEnLotProps) {
  const renseignes =
    value.mode === "commune"
      ? value.commune.canal
        ? selection.length
        : 0
      : selection.filter((s) => value.parEtudiant[s.id]?.canal).length;

  return (
    <Card className="shadow-lg">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Megaphone className="h-4 w-4" />
          Provenance{" "}
          <span className="font-normal text-muted-foreground">
            — facultatif ({renseignes}/{selection.length} renseignée
            {renseignes > 1 ? "s" : ""})
          </span>
        </CardTitle>
        <div className="flex rounded-md border p-0.5 text-sm">
          <button
            type="button"
            className={`px-3 py-1 rounded ${
              value.mode === "commune" ? "bg-primary text-primary-foreground" : ""
            }`}
            onClick={() => onChange({ ...value, mode: "commune" })}
          >
            La même pour tous
          </button>
          <button
            type="button"
            className={`px-3 py-1 rounded ${
              value.mode === "individuelle" ? "bg-primary text-primary-foreground" : ""
            }`}
            onClick={() => onChange({ ...value, mode: "individuelle" })}
          >
            Une par étudiant
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {selection.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sélectionnez des étudiants pour renseigner leur provenance.
          </p>
        ) : value.mode === "commune" ? (
          <ProvenanceFields
            draft={value.commune}
            onChange={(commune) => onChange({ ...value, commune })}
            commerciaux={commerciaux}
            onCreateCommercial={onCreateCommercial}
            students={students}
            withNote={false}
          />
        ) : (
          /*
           * Pas de conteneur à défilement ici : les listes déroulantes de
           * ProvenanceFields s'ouvrent en `absolute`, et un parent
           * `overflow-y-auto` les rognerait — le menu se retrouverait coupé en
           * plein milieu, avec deux ascenseurs imbriqués. La carte s'allonge
           * donc avec le nombre d'étudiants, et c'est la page qui défile.
           */
          <div className="space-y-4">
            {selection.map((etudiant) => (
              <div key={etudiant.id} className="rounded-md border p-3">
                <p className="font-medium text-sm mb-2">{etudiant.nom}</p>
                <ProvenanceFields
                  draft={value.parEtudiant[etudiant.id] ?? emptyProvenanceDraft()}
                  onChange={(draft) =>
                    onChange({
                      ...value,
                      parEtudiant: { ...value.parEtudiant, [etudiant.id]: draft },
                    })
                  }
                  commerciaux={commerciaux}
                  onCreateCommercial={onCreateCommercial}
                  students={students}
                  excludeStudentId={etudiant.id}
                  withNote={false}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
