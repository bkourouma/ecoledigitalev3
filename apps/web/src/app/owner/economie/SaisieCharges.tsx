"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, Wallet, Building2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { StatCard } from "@/components/owner/charts/StatCard";
import { formatFcfa } from "@/components/owner/charts/palette";
import { useOwnerFilters } from "@/components/owner/filters/owner-filters-context";
import {
  useOwnerCharges,
  useOwnerChargeCategories,
  useCreateOwnerCharge,
  useUpdateOwnerCharge,
  useDeleteOwnerCharge,
  useOwnerChargeCohortes,
} from "@/lib/hooks/use-owner-charges";
import { SearchableSelect } from "@/components/SearchableSelect";
import type { OwnerCharge } from "@ecoledigitale/contracts";

/**
 * Saisie des charges — le seul écran de l'espace propriétaire où l'on écrit.
 *
 * POURQUOI IL EST ICI, ET PAS AILLEURS
 *
 * La charge se saisit là où elle se lit. La mettre sur une route à part
 * obligerait à quitter la Rentabilité pour corriger le chiffre qu'on vient d'y
 * lire, puis à y revenir pour vérifier — deux navigations pour une correction.
 *
 * LES TROIS NIVEAUX, NOMMÉS À L'ÉCRAN
 *
 * Une charge pèse sur une cohorte, sur une classe entière, ou sur
 * l'établissement. Le troisième niveau n'est JAMAIS réparti entre les classes :
 * il est totalisé à part et affiché en pied. Une marge par filière qui absorbe
 * une quote-part de loyer inventée n'est pas une marge, c'est une opinion — et
 * l'écran doit dire laquelle des deux il montre.
 */

const NIVEAU_LABEL: Record<OwnerCharge["niveau"], string> = {
  cohorte: "Cohorte",
  classe: "Classe",
  etablissement: "Établissement",
};

const NIVEAU_AIDE: Record<OwnerCharge["niveau"], string> = {
  cohorte: "Imputée à cette promotion seule",
  classe: "Imputée à toutes les promotions de la classe",
  etablissement: "Jamais répartie entre les classes",
};

/**
 * Niveau de rattachement choisi dans le formulaire.
 *
 * « Établissement » est le défaut, et c'est un choix : c'est le cas le plus
 * fréquent (loyer, énergie, salaires administratifs), et c'est le seul qui
 * n'engage aucune imputation. Proposer « Cohorte » d'emblée inviterait à
 * rattacher par réflexe une charge qui ne l'est pas.
 */
type Rattachement = "etablissement" | "classe" | "cohorte";

/** Formulaire vide : la date du jour, parce que c'est le cas courant. */
function vide() {
  return {
    libelle: "",
    montant: "",
    engageLe: new Date().toISOString().slice(0, 10),
    payeLe: "",
    categorieId: "",
    fournisseur: "",
    rattachement: "etablissement" as Rattachement,
    programmeId: "",
    classeNomId: "",
    anneeCharge: "",
  };
}

export function SaisieCharges() {
  const { anneeScolaire, filiereIds, nomClasse, options } = useOwnerFilters();
  const [paye, setPaye] = useState<"tous" | "paye" | "engage">("tous");
  const [form, setForm] = useState(vide());
  const [editId, setEditId] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const filtres = useMemo(
    () => ({
      anneeScolaire,
      filiereIds: filiereIds.length > 0 ? filiereIds : undefined,
      nomClasse,
      paye,
      pageSize: 100,
    }),
    [anneeScolaire, filiereIds, nomClasse, paye]
  );

  const { data, isLoading, error } = useOwnerCharges(filtres);
  const { data: cats } = useOwnerChargeCategories();
  /*
     Les cohortes ne se chargent qu'une fois la classe choisie : sans elle, il
     n'y a rien à demander. La liste peut revenir vide — c'est même le cas
     courant, professional_classe_noms étant déclarative — et le formulaire
     l'explique au lieu de laisser un champ inerte.
  */
  const { data: cohortesData, isLoading: cohortesLoading } = useOwnerChargeCohortes(
    form.rattachement === "cohorte" && form.programmeId ? form.programmeId : null
  );
  const cohortes = cohortesData?.cohortes ?? [];
  const creer = useCreateOwnerCharge();
  const modifier = useUpdateOwnerCharge();
  const supprimer = useDeleteOwnerCharge();

  const enCours = creer.isPending || modifier.isPending;

  function reinitialiser() {
    setForm(vide());
    setEditId(null);
    setErreur(null);
  }

  async function soumettre() {
    setErreur(null);
    const montant = Number(form.montant);
    /*
       Le serveur refuse déjà ces deux cas avec un message rédigé. On les arrête
       ici pour éviter un aller-retour réseau sur une faute de frappe, sans
       dupliquer le RESTE des règles : la cohérence cohorte/classe et l'ordre
       des dates restent arbitrés par l'API, qui seule connaît la base.
    */
    if (!form.libelle.trim()) return setErreur("Le libellé est obligatoire.");
    if (!Number.isFinite(montant) || montant <= 0)
      return setErreur("Le montant doit être supérieur à zéro.");

    /*
       LE RATTACHEMENT EST EXCLUSIF, et le corps le reflète.

       « Établissement » envoie explicitement null sur les trois champs : sans
       cela, changer un rattachement en modification laisserait l'ancienne
       classe en base, et la charge resterait imputée à une filière qu'on vient
       justement de lui retirer.

       L'exercice n'accompagne QUE la cohorte. Sur les deux autres niveaux, la
       colonne reste nulle et le serveur déduit l'exercice de la date
       d'engagement par pivot septembre — la règle générale, qu'il ne faut pas
       court-circuiter par une valeur d'écran.
    */
    const cohorte = form.rattachement === "cohorte";
    const classe = cohorte || form.rattachement === "classe";
    if (classe && !form.programmeId) return setErreur("Choisissez une classe.");
    if (cohorte && !form.classeNomId) return setErreur("Choisissez une cohorte.");
    if (cohorte && !form.anneeCharge)
      return setErreur("Choisissez l'exercice de la cohorte.");

    const body = {
      libelle: form.libelle.trim(),
      montant,
      engageLe: form.engageLe,
      payeLe: form.payeLe || null,
      categorieId: form.categorieId || null,
      fournisseur: form.fournisseur.trim() || null,
      programmeId: classe ? form.programmeId : null,
      classeNomId: cohorte ? form.classeNomId : null,
      anneeScolaire: cohorte ? form.anneeCharge : null,
    };

    try {
      if (editId) await modifier.mutateAsync({ id: editId, body });
      else await creer.mutateAsync(body);
      reinitialiser();
    } catch (e) {
      // Le message vient du serveur et s'adresse au comptable, pas au
      // développeur : on l'affiche tel quel.
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible");
    }
  }

  function editer(c: OwnerCharge) {
    setEditId(c.id);
    setErreur(null);
    setForm({
      libelle: c.libelle,
      montant: String(c.montant),
      engageLe: c.engageLe,
      payeLe: c.payeLe ?? "",
      categorieId: c.categorieId ?? "",
      fournisseur: c.fournisseur ?? "",
      // Le niveau vient du serveur, qui le déduit des colonnes renseignées :
      // le recalculer ici ferait deux sources pour une même règle.
      rattachement: c.niveau,
      programmeId: c.programmeId ?? "",
      classeNomId: c.classeNomId ?? "",
      anneeCharge: c.anneeScolaire ?? "",
    });
  }

  const t = data?.totaux;

  return (
    <div className="space-y-8">
      <OwnerPageHeader
        title="Charges"
        question="Qu'est-ce que l'école dépense, et sur quel exercice ?"
        precision="Une charge porte deux dates : celle de son engagement et celle de son décaissement. L'écart entre les deux est la dette fournisseur. Les charges d'établissement ne sont jamais réparties entre les classes."
      />

      {/* ---- Ce que l'exercice coûte, en engagement et en caisse ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total des charges"
          value={t ? formatFcfa(t.montant) : "—"}
          hint={t ? `${t.nombre} ligne${t.nombre > 1 ? "s" : ""} sur le périmètre` : undefined}
          icon={Wallet}
        />
        <StatCard
          label="Déjà décaissé"
          value={t ? formatFcfa(t.montantPaye) : "—"}
          hint="Sorti de la caisse"
        />
        <StatCard
          label="Engagé non payé"
          value={t ? formatFcfa(t.montantEngage) : "—"}
          hint="Dette fournisseur à ce jour"
        />
        <StatCard
          label="Charges d'établissement"
          value={t ? formatFcfa(t.montantEtablissement) : "—"}
          hint="Jamais réparties entre les classes"
          icon={Building2}
        />
      </div>

      {/* ---- Saisie ------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {editId ? "Modifier la charge" : "Enregistrer une charge"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="ch-libelle">Libellé</Label>
              <Input
                id="ch-libelle"
                value={form.libelle}
                onChange={(e) => setForm({ ...form, libelle: e.target.value })}
                placeholder="Loyer de septembre, car de sortie…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-montant">Montant (FCFA)</Label>
              <Input
                id="ch-montant"
                type="number"
                min={1}
                value={form.montant}
                onChange={(e) => setForm({ ...form, montant: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-categorie">Catégorie</Label>
              <Select
                value={form.categorieId || "aucune"}
                onValueChange={(v) => setForm({ ...form, categorieId: v === "aucune" ? "" : v })}
              >
                <SelectTrigger id="ch-categorie">
                  <SelectValue placeholder="Sans catégorie" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aucune">Sans catégorie</SelectItem>
                  {(cats?.categories ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.libelle}
                      {c.estFixe ? " · fixe" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-engage">Engagée le</Label>
              <Input
                id="ch-engage"
                type="date"
                value={form.engageLe}
                onChange={(e) => setForm({ ...form, engageLe: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-paye">Décaissée le</Label>
              <Input
                id="ch-paye"
                type="date"
                value={form.payeLe}
                onChange={(e) => setForm({ ...form, payeLe: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Laisser vide tant qu&apos;elle n&apos;est pas payée : elle compte alors en
                dette fournisseur.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-fournisseur">Fournisseur</Label>
              <Input
                id="ch-fournisseur"
                value={form.fournisseur}
                onChange={(e) => setForm({ ...form, fournisseur: e.target.value })}
              />
            </div>
          </div>

          {erreur && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {erreur}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button onClick={soumettre} disabled={enCours}>
              {editId ? <Pencil className="mr-1.5 h-4 w-4" /> : <Plus className="mr-1.5 h-4 w-4" />}
              {enCours ? "Enregistrement…" : editId ? "Mettre à jour" : "Enregistrer"}
            </Button>
            {editId && (
              <Button variant="ghost" onClick={reinitialiser} disabled={enCours}>
                <X className="mr-1.5 h-4 w-4" />
                Annuler
              </Button>
            )}
          </div>

          {/* ---- Rattachement, en cascade ------------------------------- */}
          <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="ch-niveau">Cette charge pèse sur</Label>
                <Select
                  value={form.rattachement}
                  onValueChange={(v) =>
                    /*
                       Changer de niveau efface ce que le niveau précédent avait
                       rempli. Garder une classe choisie puis abandonnée la
                       renverrait au serveur, et la charge resterait imputée à
                       une filière que l'utilisateur croit avoir retirée.
                    */
                    setForm({
                      ...form,
                      rattachement: v as Rattachement,
                      programmeId: v === "etablissement" ? "" : form.programmeId,
                      classeNomId: "",
                      anneeCharge: v === "cohorte" ? form.anneeCharge : "",
                    })
                  }
                >
                  <SelectTrigger id="ch-niveau">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="etablissement">
                      L&apos;établissement — jamais répartie
                    </SelectItem>
                    <SelectItem value="classe">Une classe entière</SelectItem>
                    <SelectItem value="cohorte">Une cohorte précise</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.rattachement !== "etablissement" && (
                <div className="space-y-1.5 lg:col-span-2">
                  <Label>Classe</Label>
                  {/*
                     Recherchable : l'établissement compte quarante et une
                     classes, on ne les parcourt pas à la souris.
                  */}
                  <SearchableSelect
                    value={form.programmeId || "aucune"}
                    onChange={(v) =>
                      setForm({
                        ...form,
                        programmeId: v === "aucune" ? "" : v,
                        // La cohorte dépend de la classe : elle ne survit pas
                        // à son changement.
                        classeNomId: "",
                      })
                    }
                    placeholder="Choisir une classe…"
                    searchPlaceholder="Rechercher une classe…"
                    options={[
                      { value: "aucune", label: "Choisir une classe…" },
                      ...(options?.filieres ?? []).map((f) => ({
                        value: f.id,
                        label: f.name,
                      })),
                    ]}
                  />
                </div>
              )}

              {form.rattachement === "cohorte" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="ch-cohorte">Cohorte</Label>
                    <Select
                      value={form.classeNomId || "aucune"}
                      onValueChange={(v) =>
                        setForm({ ...form, classeNomId: v === "aucune" ? "" : v })
                      }
                      disabled={!form.programmeId || cohortesLoading || cohortes.length === 0}
                    >
                      <SelectTrigger id="ch-cohorte">
                        <SelectValue placeholder="Choisir une cohorte…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="aucune">Choisir une cohorte…</SelectItem>
                        {cohortes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nom}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="ch-exercice">Exercice de la cohorte</Label>
                    <Select
                      value={form.anneeCharge || "aucun"}
                      onValueChange={(v) =>
                        setForm({ ...form, anneeCharge: v === "aucun" ? "" : v })
                      }
                    >
                      <SelectTrigger id="ch-exercice">
                        <SelectValue placeholder="Choisir un exercice…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="aucun">Choisir un exercice…</SelectItem>
                        {(options?.anneesScolaires ?? []).map((a) => (
                          <SelectItem key={a} value={a}>
                            {a}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>

            {/*
               Le cas courant, et il faut le dire : professional_classe_noms est
               déclarative, et la plupart des classes n'y ont aucune ligne. Un
               champ vide sans explication se lit comme une panne.
            */}
            {form.rattachement === "cohorte" &&
              form.programmeId &&
              !cohortesLoading &&
              cohortes.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Aucune cohorte n&apos;est déclarée pour cette classe. Choisissez
                  «&nbsp;Une classe entière&nbsp;» : la charge pèsera sur toutes ses
                  promotions.
                </p>
              )}

            <p className="text-xs text-muted-foreground">
              {form.rattachement === "etablissement"
                ? "Une charge d'établissement n'est imputée à aucune classe et n'est jamais répartie entre elles. Elle est totalisée à part, sous l'onglet Rentabilité."
                : form.rattachement === "classe"
                  ? "La charge pèsera sur toutes les promotions de cette classe, quel que soit l'exercice."
                  : "La charge ne pèsera que sur cette promotion. L'exercice est obligatoire : « Master 2 A » sans millésime désigne toutes les promotions."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ---- Ce qui est déjà saisi --------------------------------------- */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Charges enregistrées</CardTitle>
          <Select value={paye} onValueChange={(v) => setPaye(v as typeof paye)}>
            <SelectTrigger className="w-[210px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">Toutes</SelectItem>
              <SelectItem value="engage">Engagées non payées</SelectItem>
              <SelectItem value="paye">Déjà décaissées</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="py-8 text-center text-sm text-destructive">
              {error instanceof Error ? error.message : "Chargement impossible"}
            </p>
          ) : isLoading && !data ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Chargement…</p>
          ) : !data || data.rows.length === 0 ? (
            /*
               Un vide VÉRIDIQUE, et qui le dit. Tant qu'aucune charge n'est
               saisie, la Rentabilité affiche un chiffre d'affaires et refuse le
               mot « marge » : ce message explique le lien entre les deux écrans.
            */
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Aucune charge enregistrée sur ce périmètre.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Tant qu&apos;aucune charge n&apos;est saisie, l&apos;onglet Rentabilité
                affiche un chiffre d&apos;affaires, pas une marge.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Libellé</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Niveau</TableHead>
                  <TableHead>Exercice</TableHead>
                  <TableHead>Engagée</TableHead>
                  <TableHead>Décaissée</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead className="w-[90px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {c.libelle}
                      {c.fournisseur && (
                        <span className="block text-xs text-muted-foreground">
                          {c.fournisseur}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.categorieLibelle ?? "—"}
                    </TableCell>
                    <TableCell>
                      <span title={NIVEAU_AIDE[c.niveau]}>{NIVEAU_LABEL[c.niveau]}</span>
                      {c.classeNom && (
                        <span className="block text-xs text-muted-foreground">{c.classeNom}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.anneeScolaire ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.engageLe}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.payeLe ?? (
                        // Pas un tiret : l'absence de date est une information
                        // comptable, pas une donnée manquante.
                        <span className="text-amber-600 dark:text-amber-500">non payée</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatFcfa(c.montant)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Modifier ${c.libelle}`}
                          onClick={() => editer(c)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Supprimer ${c.libelle}`}
                          disabled={supprimer.isPending}
                          onClick={() => {
                            if (editId === c.id) reinitialiser();
                            supprimer.mutate(c.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {t && t.nombre > 0 && (
            /*
               Les totaux portent sur TOUT le périmètre, pas sur les lignes
               affichées : c'est ce que renvoie l'API, et c'est la seule lecture
               qui ait un sens comptable.
            */
            <div className="mt-4 flex flex-wrap justify-end gap-x-8 gap-y-1 border-t pt-3 text-sm">
              <span className="text-muted-foreground">
                Cohortes <strong className="text-foreground">{formatFcfa(t.montantCohorte)}</strong>
              </span>
              <span className="text-muted-foreground">
                Classes <strong className="text-foreground">{formatFcfa(t.montantClasse)}</strong>
              </span>
              <span className="text-muted-foreground">
                Établissement{" "}
                <strong className="text-foreground">{formatFcfa(t.montantEtablissement)}</strong>
              </span>
              <span className="text-muted-foreground">
                Total <strong className="text-foreground">{formatFcfa(t.montant)}</strong>
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
