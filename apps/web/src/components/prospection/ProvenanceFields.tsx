"use client";

import { useState } from "react";
import { Button, Input } from "@ecoledigitale/ui";
import { Loader2, Plus, UserRound, Megaphone } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  PROVENANCE_CANAL_LABELS,
  PROVENANCE_CANAUX,
  PROVENANCE_DETAIL_LABELS,
  TAUX_COMMISSION_DEFAUT,
  canalDemandeDetail,
  type CommercialDto,
  type ProvenanceCanal,
  type ProvenanceInput,
} from "@ecoledigitale/contracts";

/**
 * Saisie de la provenance d'un étudiant — partagée par la page Inscriptions
 * (au moment d'inscrire) et la fiche de l'étudiant (pour compléter après coup).
 * Un seul endroit décrit les champs qui dépendent du canal choisi.
 */

export type ProvenanceDraft = {
  canal: ProvenanceCanal | "";
  commercial_id: string;
  /** Saisi en texte : un champ vidé ne doit pas valoir 0 %. */
  taux_commission: string;
  referent_nom: string;
  referent_student_id: string;
  media_detail: string;
  note: string;
};

export function emptyProvenanceDraft(): ProvenanceDraft {
  return {
    canal: "",
    commercial_id: "",
    taux_commission: String(TAUX_COMMISSION_DEFAUT),
    referent_nom: "",
    referent_student_id: "",
    media_detail: "",
    note: "",
  };
}

export type DraftResult = { ok: true; value: ProvenanceInput } | { ok: false; message: string };

/** Traduit la saisie en corps d'API, avec les mêmes refus que le serveur. */
export function draftToInput(draft: ProvenanceDraft): DraftResult {
  if (!draft.canal) return { ok: false, message: "Choisissez une provenance." };

  if (draft.canal === "commercial") {
    if (!draft.commercial_id) {
      return { ok: false, message: "Sélectionnez le commercial à créditer." };
    }
    const taux = Number(draft.taux_commission.replace(",", "."));
    if (!Number.isFinite(taux) || taux < 0 || taux > 100) {
      return { ok: false, message: "Le taux de commission doit être compris entre 0 et 100 %." };
    }
    return {
      ok: true,
      value: {
        canal: "commercial",
        commercial_id: draft.commercial_id,
        taux_commission: taux,
        note: draft.note.trim() || null,
      },
    };
  }

  if (draft.canal === "connaissance" && !draft.referent_nom.trim()) {
    return { ok: false, message: "Indiquez le nom de la personne qui a référé l'étudiant." };
  }
  if (draft.canal === "etudiant" && !draft.referent_student_id) {
    return { ok: false, message: "Sélectionnez l'étudiant qui a référé." };
  }
  if (draft.canal === "autre" && !draft.media_detail.trim()) {
    return { ok: false, message: "Précisez la provenance." };
  }

  return {
    ok: true,
    value: {
      canal: draft.canal,
      referent_nom: draft.canal === "connaissance" ? draft.referent_nom.trim() : null,
      referent_student_id: draft.canal === "etudiant" ? draft.referent_student_id : null,
      media_detail: canalDemandeDetail(draft.canal) ? draft.media_detail.trim() || null : null,
      note: draft.note.trim() || null,
    },
  };
}

/** Remet une fiche existante sous forme de brouillon éditable. */
export function draftFromRow(row: {
  canal?: ProvenanceCanal | null;
  commercial_id?: string | null;
  taux_commission?: number | null;
  referent_nom?: string | null;
  referent_student_id?: string | null;
  media_detail?: string | null;
  note?: string | null;
}): ProvenanceDraft {
  return {
    canal: row.canal ?? "",
    commercial_id: row.commercial_id ?? "",
    taux_commission:
      row.taux_commission == null ? String(TAUX_COMMISSION_DEFAUT) : String(row.taux_commission),
    referent_nom: row.referent_nom ?? "",
    referent_student_id: row.referent_student_id ?? "",
    media_detail: row.media_detail ?? "",
    note: row.note ?? "",
  };
}

export type StudentOption = { id: string; nom: string };

type ProvenanceFieldsProps = {
  draft: ProvenanceDraft;
  onChange: (draft: ProvenanceDraft) => void;
  commerciaux: CommercialDto[];
  /** Crée un commercial à la volée et renvoie sa fiche. */
  onCreateCommercial: (nom: string, taux: number) => Promise<CommercialDto>;
  /** Étudiants proposés comme référents (le canal « Un étudiant »). */
  students?: StudentOption[];
  /** Exclu de la liste des référents : personne ne se réfère soi-même. */
  excludeStudentId?: string;
  /** Masque le champ de commentaire, inutile sur les formulaires en lot. */
  withNote?: boolean;
  disabled?: boolean;
};

export function ProvenanceFields({
  draft,
  onChange,
  commerciaux,
  onCreateCommercial,
  students = [],
  excludeStudentId,
  withNote = true,
  disabled = false,
}: ProvenanceFieldsProps) {
  const [nouveauNom, setNouveauNom] = useState("");
  const [creation, setCreation] = useState(false);
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);

  const set = (patch: Partial<ProvenanceDraft>) => onChange({ ...draft, ...patch });

  const canalOptions = PROVENANCE_CANAUX.map((canal) => ({
    value: canal,
    label: PROVENANCE_CANAL_LABELS[canal],
  }));

  const commerciauxActifs = commerciaux.filter((c) => c.actif || c.id === draft.commercial_id);

  async function creerCommercial() {
    const nom = nouveauNom.trim();
    if (!nom) return;
    setErreurCreation(null);
    setCreation(true);
    try {
      const taux = Number(draft.taux_commission.replace(",", ".")) || TAUX_COMMISSION_DEFAUT;
      const cree = await onCreateCommercial(nom, taux);
      set({ commercial_id: cree.id, taux_commission: String(cree.taux_commission) });
      setNouveauNom("");
    } catch (error: any) {
      setErreurCreation(error?.message ?? "Impossible d'ajouter ce commercial.");
    } finally {
      setCreation(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground">Provenance</label>
        <SearchableSelect
          value={draft.canal}
          onChange={(value) => set({ canal: value as ProvenanceCanal })}
          options={canalOptions}
          placeholder="Comment nous a-t-il connus ?"
          searchPlaceholder="Rechercher…"
          icon={<Megaphone className="h-4 w-4 text-gray-400" />}
          disabled={disabled}
        />
      </div>

      {draft.canal === "commercial" && (
        <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/40 p-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Commercial</label>
              <SearchableSelect
                value={draft.commercial_id}
                onChange={(value) => {
                  const choisi = commerciaux.find((c) => c.id === value);
                  set({
                    commercial_id: value,
                    // Le taux du commercial n'est qu'une proposition : il reste
                    // modifiable étudiant par étudiant.
                    taux_commission: choisi
                      ? String(choisi.taux_commission)
                      : draft.taux_commission,
                  });
                }}
                options={commerciauxActifs.map((c) => ({ value: c.id, label: c.nom }))}
                placeholder="Sélectionner un commercial"
                searchPlaceholder="Rechercher un commercial…"
                icon={<UserRound className="h-4 w-4 text-gray-400" />}
                disabled={disabled}
              />
            </div>
            <div className="sm:w-32">
              <label className="text-xs font-medium text-muted-foreground">Commission</label>
              <div className="relative">
                <Input
                  value={draft.taux_commission}
                  onChange={(e) => set({ taux_commission: e.target.value })}
                  inputMode="decimal"
                  className="pr-7"
                  disabled={disabled}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground">
                Nouveau commercial
              </label>
              <Input
                value={nouveauNom}
                onChange={(e) => setNouveauNom(e.target.value)}
                placeholder="Nom du commercial à ajouter à la liste"
                disabled={disabled || creation}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void creerCommercial();
                  }
                }}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void creerCommercial()}
              disabled={disabled || creation || !nouveauNom.trim()}
            >
              {creation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>
          {erreurCreation && <p className="text-xs text-red-600">{erreurCreation}</p>}
          <p className="text-xs text-muted-foreground">
            Le taux est figé sur la fiche de l&apos;étudiant : il s&apos;applique à chaque
            règlement encaissé sur la ligne « Scolarité » de son barème.
          </p>
        </div>
      )}

      {draft.canal === "connaissance" && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Nom de la personne qui a référé
          </label>
          <Input
            value={draft.referent_nom}
            onChange={(e) => set({ referent_nom: e.target.value })}
            placeholder="Nom et prénoms"
            disabled={disabled}
          />
        </div>
      )}

      {draft.canal === "etudiant" && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Étudiant référent</label>
          <SearchableSelect
            value={draft.referent_student_id}
            onChange={(value) => set({ referent_student_id: value })}
            options={students
              .filter((s) => s.id !== excludeStudentId)
              .map((s) => ({ value: s.id, label: s.nom }))}
            placeholder="Sélectionner un étudiant"
            searchPlaceholder="Rechercher un étudiant…"
            icon={<UserRound className="h-4 w-4 text-gray-400" />}
            disabled={disabled}
          />
        </div>
      )}

      {/* Toute provenance qui n'est ni Google, ni Facebook, ni un commercial
          réclame une précision : sans elle, « Radio / Télé / Journal » ou
          « Autre » n'apprennent rien à personne. */}
      {draft.canal !== "" && canalDemandeDetail(draft.canal) && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            {PROVENANCE_DETAIL_LABELS[draft.canal] ?? "Précisez"}
            {draft.canal === "autre" && <span className="text-red-500"> *</span>}
          </label>
          <Input
            value={draft.media_detail}
            onChange={(e) => set({ media_detail: e.target.value })}
            placeholder={
              draft.canal === "autre_media"
                ? "Ex. : Radio Côte d'Ivoire, RTI 1, Fraternité Matin…"
                : "Facultatif"
            }
            disabled={disabled}
          />
        </div>
      )}

      {withNote && draft.canal !== "" && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Commentaire</label>
          <Input
            value={draft.note}
            onChange={(e) => set({ note: e.target.value })}
            placeholder="Facultatif"
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}
