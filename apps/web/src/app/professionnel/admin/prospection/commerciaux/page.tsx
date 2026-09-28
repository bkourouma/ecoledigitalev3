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
  Input,
} from "@ecoledigitale/ui";
import { AlertTriangle, Briefcase, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  useCommerciaux,
  useCreateCommercial,
  useDeleteCommercial,
  useUpdateCommercial,
} from "@/lib/hooks/use-prospection";
import { ExportButtons } from "@/components/ExportButtons";
import { openCommerciauxPdf } from "@/lib/utils/commerciaux-report";
import { TAUX_COMMISSION_DEFAUT, type CommercialDto } from "@ecoledigitale/contracts";

/**
 * Commerciaux — la liste se construit au fil des inscriptions ; cet écran sert
 * à la corriger, à ajuster un taux par défaut et à mettre au repos ceux qui ne
 * prospectent plus.
 */

type FormState = {
  nom: string;
  telephone: string;
  email: string;
  taux_commission: string;
  note: string;
};

const emptyForm = (): FormState => ({
  nom: "",
  telephone: "",
  email: "",
  taux_commission: String(TAUX_COMMISSION_DEFAUT),
  note: "",
});

export default function CommerciauxPage() {
  const commerciauxQuery = useCommerciaux();
  const createCommercial = useCreateCommercial();
  const updateCommercial = useUpdateCommercial();
  const deleteCommercial = useDeleteCommercial();

  const [ouvert, setOuvert] = useState(false);
  const [edite, setEdite] = useState<CommercialDto | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [erreur, setErreur] = useState<string | null>(null);
  const [exportErreur, setExportErreur] = useState<string | null>(null);

  const commerciaux = commerciauxQuery.data ?? [];
  const enCours = createCommercial.isPending || updateCommercial.isPending;

  function ouvrirCreation() {
    setEdite(null);
    setForm(emptyForm());
    setErreur(null);
    setOuvert(true);
  }

  function ouvrirEdition(c: CommercialDto) {
    setEdite(c);
    setForm({
      nom: c.nom,
      telephone: c.telephone ?? "",
      email: c.email ?? "",
      taux_commission: String(c.taux_commission),
      note: c.note ?? "",
    });
    setErreur(null);
    setOuvert(true);
  }

  async function enregistrer() {
    const nom = form.nom.trim();
    if (!nom) return setErreur("Le nom est requis.");
    const taux = Number(form.taux_commission.replace(",", "."));
    if (!Number.isFinite(taux) || taux < 0 || taux > 100) {
      return setErreur("Le taux doit être compris entre 0 et 100 %.");
    }
    setErreur(null);

    const payload = {
      nom,
      telephone: form.telephone.trim() || null,
      email: form.email.trim() || null,
      taux_commission: taux,
      note: form.note.trim() || null,
    };

    try {
      if (edite) await updateCommercial.mutateAsync({ id: edite.id, ...payload });
      else await createCommercial.mutateAsync(payload);
      setOuvert(false);
    } catch (error: any) {
      setErreur(error?.message ?? "Enregistrement impossible.");
    }
  }

  async function basculerActif(c: CommercialDto) {
    try {
      await updateCommercial.mutateAsync({ id: c.id, actif: !c.actif });
    } catch (error: any) {
      window.alert(error?.message ?? "Modification impossible.");
    }
  }

  async function supprimer(c: CommercialDto) {
    if (!window.confirm(`Supprimer définitivement ${c.nom} ?`)) return;
    try {
      await deleteCommercial.mutateAsync(c.id);
    } catch (error: any) {
      window.alert(error?.message ?? "Suppression impossible.");
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
            <Briefcase className="h-7 w-7 text-indigo-500" />
            Commerciaux
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Le taux indiqué ici est celui proposé par défaut lors d&apos;une nouvelle inscription ;
            il reste modifiable étudiant par étudiant.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {/* Le PDF porte la liste affichée, actifs et inactifs compris. */}
          <ExportButtons
            formats={["pdf"]}
            disabled={commerciauxQuery.isLoading || commerciaux.length === 0}
            onExportPdf={(win) => openCommerciauxPdf(commerciaux, win)}
            onError={setExportErreur}
          />
          <Button onClick={ouvrirCreation}>
            <Plus className="h-4 w-4 mr-2" />
            Ajouter un commercial
          </Button>
        </div>
      </div>

      {exportErreur && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {exportErreur}
        </div>
      )}

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-base">
            {commerciaux.length} {commerciaux.length > 1 ? "commerciaux" : "commercial"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {commerciauxQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
              Chargement…
            </p>
          ) : commerciauxQuery.isError ? (
            <p className="py-8 text-center text-sm text-red-600">
              <AlertTriangle className="h-4 w-4 inline mr-2" />
              {(commerciauxQuery.error as Error)?.message ?? "Chargement impossible."}
            </p>
          ) : commerciaux.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Aucun commercial. La liste se remplit aussi toute seule : à l&apos;inscription, le
              canal « Commercial IPAM » permet d&apos;en ajouter un à la volée.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Nom</th>
                    <th className="py-2 pr-3">Téléphone</th>
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3 text-right">Taux par défaut</th>
                    <th className="py-2 pr-3 text-right">Étudiants</th>
                    <th className="py-2 pr-3">Statut</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {commerciaux.map((c) => (
                    <tr key={c.id} className="hover:bg-accent/40">
                      <td className="py-2 pr-3 font-medium">{c.nom}</td>
                      <td className="py-2 pr-3">{c.telephone ?? "—"}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{c.email ?? "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{c.taux_commission} %</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{c.etudiants}</td>
                      <td className="py-2 pr-3">
                        <button type="button" onClick={() => void basculerActif(c)}>
                          <Badge variant={c.actif ? "default" : "secondary"}>
                            {c.actif ? "Actif" : "Inactif"}
                          </Badge>
                        </button>
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => ouvrirEdition(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void supprimer(c)}>
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

      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{edite ? `Modifier ${edite.nom}` : "Nouveau commercial"}</DialogTitle>
          </DialogHeader>
          {erreur && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {erreur}
            </div>
          )}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Nom</label>
              <Input
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value })}
                placeholder="Nom et prénoms"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Téléphone</label>
                <Input
                  value={form.telephone}
                  onChange={(e) => setForm({ ...form, telephone: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Taux par défaut (%)
                </label>
                <Input
                  value={form.taux_commission}
                  onChange={(e) => setForm({ ...form, taux_commission: e.target.value })}
                  inputMode="decimal"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <Input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                type="email"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Note</label>
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Facultatif"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOuvert(false)}>
              Annuler
            </Button>
            <Button onClick={() => void enregistrer()} disabled={enCours}>
              {enCours && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Enregistrer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
