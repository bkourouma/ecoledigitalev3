"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Textarea,
  Alert,
  AlertDescription,
} from "@ecoledigitale/ui";
import { PenLine, Loader2, Save, AlertCircle, CheckCircle2 } from "lucide-react";
import { SIGNATAIRE_LABELS, type SignataireCle, type SignataireDto } from "@ecoledigitale/contracts";
import {
  useSignataires,
  useUpdateSignataire,
  indexSignataires,
} from "@/lib/hooks/use-professional-signataires";

interface FormState {
  nom: string;
  qualite: string;
  fonction: string;
}

export default function SignatairesPage() {
  const signatairesQuery = useSignataires();
  const updateMut = useUpdateSignataire();

  const [forms, setForms] = useState<Record<string, FormState>>({});
  // Fiches modifiées et pas encore enregistrées : à préserver d'un rafraîchissement.
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedCle, setSavedCle] = useState<SignataireCle | null>(null);

  const byCle = useMemo(
    () => indexSignataires(signatairesQuery.data as SignataireDto[] | undefined),
    [signatairesQuery.data]
  );

  // Initialise les formulaires à partir des valeurs enregistrées.
  //
  // Une fiche en cours de modification n'est JAMAIS réécrite ici. Sans cette
  // précaution, le moindre rafraîchissement en arrière-plan (retour sur
  // l'onglet, reprise de connexion) remplaçait la saisie en cours par la
  // valeur d'origine : la frappe et la réécriture s'entremêlaient, et on
  // enregistrait un nom composite du genre « Celeste BAHKoffi Signataire ».
  useEffect(() => {
    if (!signatairesQuery.data) return;
    setForms((prev) => {
      const next: Record<string, FormState> = { ...prev };
      for (const { cle } of SIGNATAIRE_LABELS) {
        if (dirty[cle]) continue;
        const s = byCle[cle];
        next[cle] = {
          nom: s?.nom ?? "",
          qualite: s?.qualite ?? "",
          fonction: s?.fonction ?? "",
        };
      }
      return next;
    });
  }, [signatairesQuery.data, byCle, dirty]);

  function setField(cle: SignataireCle, field: keyof FormState, value: string) {
    setForms((prev) => ({ ...prev, [cle]: { ...prev[cle], [field]: value } }));
    setDirty((prev) => ({ ...prev, [cle]: true }));
    setSavedCle(null);
  }

  // Le champ arrive pré-rempli par le signataire en place. On sélectionne son
  // contenu à la prise de focus : la valeur existante devient visible comme
  // telle, et taper la remplace au lieu de s'y ajouter.
  function selectOnFocus(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const el = e.currentTarget;
    // La sélection attend la fin du cycle courant : au clic, le relâchement du
    // bouton qui suit la prise de focus repositionne le curseur et annulerait
    // une sélection posée trop tôt. On n'utilise pas requestAnimationFrame :
    // il ne se déclenche pas dans un onglet en arrière-plan.
    setTimeout(() => el.select(), 0);
  }

  async function handleSave(cle: SignataireCle) {
    const form = forms[cle];
    if (!form || !form.nom.trim()) {
      setError("Le nom est requis.");
      return;
    }
    setError(null);
    setSavedCle(null);
    try {
      await updateMut.mutateAsync({
        cle,
        data: {
          nom: form.nom.trim(),
          qualite: form.qualite.trim() || null,
          fonction: form.fonction.trim() || null,
        },
      });
      setSavedCle(cle);
      setDirty((prev) => ({ ...prev, [cle]: false }));
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'enregistrement du signataire.");
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-slate-700 to-slate-500 bg-clip-text text-transparent flex items-center gap-2">
          <PenLine className="h-7 w-7 text-slate-500" />
          Signataires des documents
        </h1>
        <p className="text-muted-foreground max-w-3xl whitespace-nowrap text-sm md:text-base">
          Noms et titres imprimés sur l'attestation de réussite, le diplôme et l'attestation
          d'authenticité. Un seul nom est enregistré par titre : la modification s'applique
          immédiatement aux prochains documents générés.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {signatairesQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="space-y-4">
          {SIGNATAIRE_LABELS.map((slot) => {
            const form = forms[slot.cle] ?? { nom: "", qualite: "", fonction: "" };
            const busy = updateMut.isPending && updateMut.variables?.cle === slot.cle;
            const saved = savedCle === slot.cle;
            return (
              <Card key={slot.cle} className="shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{slot.titre}</CardTitle>
                  <CardDescription>{slot.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                        Nom <span className="text-red-500">*</span>
                      </label>
                      <Input
                        value={form.nom}
                        onFocus={selectOnFocus}
                        onChange={(e) => setField(slot.cle, "nom", e.target.value)}
                        placeholder="Nom imprimé sur le document"
                      />
                    </div>
                    {slot.withQualite && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                          Qualité
                        </label>
                        <Input
                          value={form.qualite}
                          onFocus={selectOnFocus}
                          onChange={(e) => setField(slot.cle, "qualite", e.target.value)}
                          placeholder="Ex. Enseignant Chercheur"
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Fonction / titre
                      {slot.fonctionMultiligne && (
                        <span className="font-normal"> — une ligne par retour à la ligne</span>
                      )}
                    </label>
                    {slot.fonctionMultiligne ? (
                      <Textarea
                        value={form.fonction}
                        onFocus={selectOnFocus}
                        onChange={(e) => setField(slot.cle, "fonction", e.target.value)}
                        rows={2}
                        placeholder={"Directeur du Comité Scientifique\nDirecteur de Recherche"}
                      />
                    ) : (
                      <Input
                        value={form.fonction}
                        onFocus={selectOnFocus}
                        onChange={(e) => setField(slot.cle, "fonction", e.target.value)}
                        placeholder="Ex. Directeur des Etudes"
                      />
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-3">
                    {saved && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Enregistré
                      </span>
                    )}
                    <Button size="sm" onClick={() => handleSave(slot.cle)} disabled={busy}>
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Enregistrer
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
