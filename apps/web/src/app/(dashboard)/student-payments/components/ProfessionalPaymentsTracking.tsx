"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  AlertCircle,
  CheckCircle2,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Layers,
  Loader2,
  Receipt,
} from "lucide-react";
import {
  useMyProfessionalEnrollments,
  useMyProfessionalPayments,
} from "@/lib/hooks/use-professional-student";
import { SearchableSelect } from "@/components/SearchableSelect";

/**
 * Traçabilité des paiements du Module Professionnel, côté étudiant.
 *
 * Contrepartie de la page admin `/professionnel/admin/paiements` : l'étudiant y
 * retrouve ce que l'administration voit de LUI — ses UE regroupées par classe
 * puis par session, ce qui est dû, ce qui a été encaissé, ce qu'il reste à
 * régler, et la liste de ses versements.
 *
 * Les REÇUS n'y figurent pas : l'écran suit les règlements, il ne délivre aucun
 * justificatif. L'API étudiante ne renvoie d'ailleurs ni numéro ni lien de reçu.
 *
 * Deux écarts assumés avec l'écran admin, tous deux au profit de l'exactitude :
 *
 * - le total versé se lit sur les VERSEMENTS, pas en additionnant le « payé »
 *   de chaque inscription : plusieurs UE partagent une même commande, et
 *   cumuler ligne à ligne compterait le même règlement autant de fois ;
 * - le dû d'une ligne est son `prix_unitaire`, pas le montant de sa commande.
 *
 * Les UE de « conduite » sont écartées côté serveur (`listEnrollments`), comme
 * elles le sont de l'écran des paiements : transversales, elles ne se facturent
 * pas.
 */

const MODE_LABELS: Record<string, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  virement: "Virement bancaire",
  carte: "Carte bancaire",
  autre: "Autre",
};

const STATUT_PAIEMENT: Record<string, { label: string; cls: string }> = {
  confirme: { label: "Confirmé", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  en_attente: { label: "En attente", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  echoue: { label: "Échoué", cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  annule: { label: "Annulé", cls: "bg-muted text-muted-foreground border-border" },
};

const STATUT_INSCRIPTION: Record<string, string> = {
  en_attente: "En attente",
  active: "Active",
  confirme: "Confirmée",
  confirmee: "Confirmée",
  terminee: "Terminée",
};

/** États de règlement de l'écran admin, repris à l'identique. */
const ETATS: Record<string, { label: string; cls: string }> = {
  non_regle: { label: "Non réglé", cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  partiel: { label: "Partiellement réglé", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  solde: { label: "Soldé", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
};

/** Même tolérance que l'écran admin : au demi-franc près, c'est réglé. */
function etatDe(du: number, verse: number): keyof typeof ETATS {
  if (verse <= 0.5) return "non_regle";
  return du - verse <= 0.5 ? "solde" : "partiel";
}

const fmtMontant = (v: number | null | undefined): string =>
  `${Math.round(Number(v ?? 0)).toLocaleString("fr-FR")} FCFA`;

const fmtDate = (v: string | null | undefined): string => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("fr-FR");
};

/**
 * Libellé de session servant de regroupement : le libellé amputé de son
 * suffixe « — CODE UE », comme sur l'écran admin — sans quoi chaque UE
 * formerait sa propre session.
 */
function libelleSession(e: any): string {
  const lib = String(e.session_libelle ?? "").trim();
  const code = String(e.ue_code ?? "").trim();
  if (code && lib.endsWith(code)) {
    return lib.slice(0, lib.length - code.length).replace(/[\s—–-]+$/u, "").trim() || lib;
  }
  return lib || "Session";
}

const PAGE_SIZES = [10, 20, 50];

/**
 * Pied de pagination commun aux deux listes : taille de page, plage affichée
 * et navigation. La pagination est cliente — tout est déjà chargé.
 */
function PiedPagination({
  total,
  premierIndex,
  nbAffiches,
  taille,
  page,
  nbPages,
  onTaille,
  onPage,
}: {
  total: number;
  premierIndex: number;
  nbAffiches: number;
  taille: number;
  page: number;
  nbPages: number;
  onTaille: (n: number) => void;
  onPage: (n: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Lignes par page</span>
        <Select value={String(taille)} onValueChange={(v) => onTaille(Number(v))}>
          <SelectTrigger className="h-8 w-[4.5rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>
          {premierIndex + 1}–{premierIndex + nbAffiches} sur {total}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Précédent
        </Button>
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          Page {page} / {nbPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page >= nbPages}
          onClick={() => onPage(page + 1)}
        >
          Suivant
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

export function ProfessionalPaymentsTracking() {
  const enrollmentsQuery = useMyProfessionalEnrollments();
  const paymentsQuery = useMyProfessionalPayments();

  // Cascade : l'année scolaire commande les noms de classe, qui commandent
  // les semestres. Ces filtres ne portent que sur le détail des UE ; les
  // totaux du haut restent globaux (voir plus bas).
  const [annee, setAnnee] = useState("all");
  const [classeNom, setClasseNom] = useState("all");
  const [semestreId, setSemestreId] = useState("all");

  // Pagination cliente, indépendante pour chacune des deux listes.
  const [ueTaille, setUeTaille] = useState(PAGE_SIZES[0]);
  const [uePage, setUePage] = useState(1);
  const [versTaille, setVersTaille] = useState(PAGE_SIZES[0]);
  const [versPage, setVersPage] = useState(1);

  const inscriptions: any[] = useMemo(() => {
    const data = enrollmentsQuery.data as any;
    const rows: any[] = Array.isArray(data) ? data : (data?.items ?? []);
    // Une inscription annulée n'est plus due : la garder fausserait le solde.
    return rows.filter((e) => e.statut !== "annulee");
  }, [enrollmentsQuery.data]);

  const versements: any[] = paymentsQuery.data?.payments ?? [];

  const totaux = useMemo(() => {
    const du = inscriptions.reduce((s, e) => s + Number(e.prix_unitaire ?? 0), 0);
    const verse = Number(paymentsQuery.data?.total_verse ?? 0);
    return { du, verse, reste: Math.max(0, du - verse), etat: etatDe(du, verse) };
  }, [inscriptions, paymentsQuery.data]);

  // Le nom de classe d'une inscription, avec repli sur la filière.
  const nomDe = (e: any) => String(e.classe_nom ?? e.filiere_name ?? "Classe");

  // Années scolaires couvertes par les inscriptions.
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of inscriptions) if (e.annee_scolaire) set.add(e.annee_scolaire);
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [inscriptions]);

  // Noms de classe de l'année retenue.
  const classeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of inscriptions) {
      if (annee !== "all" && e.annee_scolaire !== annee) continue;
      set.add(nomDe(e));
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "fr"))
      .map((value) => ({ value, label: value }));
  }, [inscriptions, annee]);

  // Semestres de l'année et de la classe retenues.
  const semestreOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of inscriptions) {
      if (!e.semestre_id) continue;
      if (annee !== "all" && e.annee_scolaire !== annee) continue;
      if (classeNom !== "all" && nomDe(e) !== classeNom) continue;
      map.set(e.semestre_id, e.semestre_libelle ?? "Semestre");
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "fr", { numeric: true })
    );
  }, [inscriptions, annee, classeNom]);

  const inscriptionsVisibles = useMemo(
    () =>
      inscriptions.filter(
        (e) =>
          (annee === "all" || e.annee_scolaire === annee) &&
          (classeNom === "all" || nomDe(e) === classeNom) &&
          (semestreId === "all" || e.semestre_id === semestreId)
      ),
    [inscriptions, annee, classeNom, semestreId]
  );

  // La page courante est bornée : un filtre plus restrictif peut la rendre
  // caduque sans qu'on ait à la réinitialiser à chaque frappe.
  const ueNbPages = Math.max(1, Math.ceil(inscriptionsVisibles.length / ueTaille));
  const uePageCourante = Math.min(uePage, ueNbPages);
  const uePremierIndex = (uePageCourante - 1) * ueTaille;
  const inscriptionsPage = useMemo(
    () => inscriptionsVisibles.slice(uePremierIndex, uePremierIndex + ueTaille),
    [inscriptionsVisibles, uePremierIndex, ueTaille]
  );

  const versNbPages = Math.max(1, Math.ceil(versements.length / versTaille));
  const versPageCourante = Math.min(versPage, versNbPages);
  const versPremierIndex = (versPageCourante - 1) * versTaille;
  const versementsPage = useMemo(
    () => versements.slice(versPremierIndex, versPremierIndex + versTaille),
    [versements, versPremierIndex, versTaille]
  );

  /**
   * Une entrée par nom de classe, puis une sous-entrée par semestre.
   * Le regroupement porte sur la PAGE courante : la taille de page compte
   * des UE, pas des classes.
   */
  const classes = useMemo(() => {
    const parClasse = new Map<string, any>();
    for (const e of inscriptionsPage) {
      const cle = nomDe(e);
      let c = parClasse.get(cle);
      if (!c) {
        c = { cle, nom: cle, annee: e.annee_scolaire ?? null, du: 0, sessions: new Map<string, any>() };
        parClasse.set(cle, c);
      }
      c.du += Number(e.prix_unitaire ?? 0);

      // Sous-entrée = semestre ; repli sur le libellé de cohorte pour une
      // inscription qui n'est rattachée à aucun semestre.
      const libelle = e.semestre_libelle ?? libelleSession(e);
      let s = c.sessions.get(libelle);
      if (!s) {
        s = { libelle, du: 0, items: [] as any[] };
        c.sessions.set(libelle, s);
      }
      s.du += Number(e.prix_unitaire ?? 0);
      s.items.push(e);
    }
    return Array.from(parClasse.values())
      .map((c) => ({
        ...c,
        sessions: Array.from(c.sessions.values()).sort((a: any, b: any) =>
          a.libelle.localeCompare(b.libelle, "fr", { numeric: true })
        ),
      }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  }, [inscriptionsPage]);

  if (enrollmentsQuery.isLoading || paymentsQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  const erreur =
    (enrollmentsQuery.error as Error)?.message ?? (paymentsQuery.error as Error)?.message ?? null;
  if (erreur) {
    return (
      <Card className="border-red-500/40">
        <CardContent className="flex items-center gap-3 py-8 text-red-400">
          <AlertCircle className="h-6 w-6 shrink-0" />
          <p>{erreur}</p>
        </CardContent>
      </Card>
    );
  }

  if (inscriptions.length === 0 && versements.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
          <div className="rounded-full bg-muted p-4">
            <Layers className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground max-w-md">
            Aucune inscription au Module Professionnel pour le moment.
          </p>
        </CardContent>
      </Card>
    );
  }

  const etat = ETATS[totaux.etat];
  const nbConfirmes = versements.filter((p) => p.statut === "confirme").length;

  return (
    <div className="space-y-6">
      {/* Totaux — mêmes notions que la page Paiements de l'administration. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Total
          label="Total dû"
          valeur={fmtMontant(totaux.du)}
          hint={`${inscriptions.length} UE inscrite(s)`}
          icone={<DollarSign className="h-6 w-6 text-sky-400" />}
          fond="bg-sky-500/15"
        />
        <Total
          label="Total versé"
          valeur={fmtMontant(totaux.verse)}
          hint={`${nbConfirmes} versement(s) confirmé(s)`}
          icone={<CheckCircle2 className="h-6 w-6 text-emerald-400" />}
          fond="bg-emerald-500/15"
          couleur="text-emerald-400"
        />
        <Total
          label="Reste à payer"
          valeur={fmtMontant(totaux.reste)}
          hint={totaux.reste === 0 ? "Tout est réglé" : "à régler auprès de la scolarité"}
          icone={<Clock className="h-6 w-6 text-amber-400" />}
          fond="bg-amber-500/15"
          couleur="text-amber-400"
        />
      </div>

      {/* Inscriptions : ce qui compose le montant dû, classe par classe. */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
          <Layers className="h-4 w-4 text-emerald-400 shrink-0" />
          <span className="font-semibold">Mes unités d&apos;enseignement</span>
          <span className="text-xs text-muted-foreground">· ce qui compose le montant dû</span>
          <span
            className={`ml-auto inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${etat.cls}`}
          >
            {etat.label}
          </span>
        </div>

        {anneeOptions.length > 0 && (
          <div className="border-b border-border px-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* L'année ouvre la cascade : elle occupe sa propre ligne. */}
              <div className="md:col-span-2">
                <label className="text-sm font-medium">Année scolaire</label>
                <div className="mt-1.5">
                  <SearchableSelect
                    value={annee}
                    onChange={(v) => {
                      setAnnee(v);
                      // Classes et semestres dépendent de l'année.
                      setClasseNom("all");
                      setSemestreId("all");
                      setUePage(1);
                    }}
                    icon={<CalendarRange className="h-4 w-4 text-muted-foreground" />}
                    placeholder="Toutes les années"
                    searchPlaceholder="Rechercher une année…"
                    options={[{ value: "all", label: "Toutes les années" }, ...anneeOptions]}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Nom de classe</label>
                <div className="mt-1.5">
                  <SearchableSelect
                    value={classeNom}
                    onChange={(v) => {
                      setClasseNom(v);
                      setSemestreId("all");
                      setUePage(1);
                    }}
                    icon={<Layers className="h-4 w-4 text-muted-foreground" />}
                    placeholder="Tous les noms de classe"
                    searchPlaceholder="Rechercher un nom de classe…"
                    options={[
                      { value: "all", label: "Tous les noms de classe" },
                      ...classeOptions,
                    ]}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Semestre</label>
                <div className="mt-1.5">
                  <SearchableSelect
                    value={semestreId}
                    onChange={(v) => {
                      setSemestreId(v);
                      setUePage(1);
                    }}
                    icon={<CalendarRange className="h-4 w-4 text-muted-foreground" />}
                    placeholder="Tous les semestres"
                    searchPlaceholder="Rechercher un semestre…"
                    options={[
                      { value: "all", label: "Tous les semestres" },
                      ...semestreOptions,
                    ]}
                  />
                </div>
              </div>
            </div>
            {inscriptionsVisibles.length !== inscriptions.length && (
              <p className="mt-3 text-xs text-muted-foreground">
                {inscriptionsVisibles.length} UE affichée(s) sur {inscriptions.length}.
                Les totaux ci-dessus restent calculés sur l&apos;ensemble de vos
                inscriptions.
              </p>
            )}
          </div>
        )}
        <CardContent className="p-0">
          {classes.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {inscriptions.length === 0
                ? "Aucune inscription en cours."
                : "Aucune inscription pour les filtres sélectionnés."}
            </p>
          ) : (
            classes.map((c) => (
              <div key={c.cle} className="border-b border-border/60 last:border-0">
                <div className="flex items-center justify-between gap-2 bg-muted/20 px-4 py-2">
                  <span className="font-medium">
                    {c.nom}
                    {c.annee && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {c.annee}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-sm">{fmtMontant(c.du)}</span>
                </div>
                {c.sessions.map((s: any) => (
                  <div key={s.libelle}>
                    <div className="flex items-center justify-between gap-2 px-6 py-1.5 text-xs text-muted-foreground">
                      <span>{s.libelle}</span>
                      <span className="font-mono">{fmtMontant(s.du)}</span>
                    </div>
                    <div className="overflow-auto">
                      <table className="min-w-full text-sm border-collapse">
                        <tbody>
                          {s.items.map((e: any) => (
                            <tr key={e.id} className="border-t border-border/40">
                              <td className="px-6 py-2">
                                <span className="font-medium">{e.ue_libelle ?? "—"}</span>
                                {e.ue_code && (
                                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                                    {e.ue_code}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                                {fmtDate(e.date_debut)} → {fmtDate(e.date_fin)}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                                {e.order_reference ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-center text-xs">
                                {STATUT_INSCRIPTION[String(e.statut)] ?? String(e.statut ?? "—")}
                              </td>
                              <td className="px-4 py-2 text-right font-mono whitespace-nowrap">
                                {fmtMontant(e.prix_unitaire)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
          <PiedPagination
            total={inscriptionsVisibles.length}
            premierIndex={uePremierIndex}
            nbAffiches={inscriptionsPage.length}
            taille={ueTaille}
            page={uePageCourante}
            nbPages={ueNbPages}
            onTaille={(n) => {
              setUeTaille(n);
              setUePage(1);
            }}
            onPage={setUePage}
          />
        </CardContent>
      </Card>

      {/* Versements : la traçabilité proprement dite. */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
          <Receipt className="h-4 w-4 text-emerald-400 shrink-0" />
          <span className="font-semibold">Mes versements</span>
          <span className="text-xs text-muted-foreground">
            · du plus récent au plus ancien, tels qu&apos;enregistrés par la scolarité
          </span>
        </div>
        <CardContent className="p-0 overflow-auto">
          {versements.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Aucun versement enregistré pour le moment.
            </p>
          ) : (
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/50 border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-3 py-3 font-medium">Commande</th>
                  <th className="px-3 py-3 font-medium">Mode</th>
                  <th className="px-3 py-3 font-medium">Référence</th>
                  <th className="px-3 py-3 font-medium text-center">Statut</th>
                  <th className="px-4 py-3 font-medium text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {versementsPage.map((p) => {
                  const st = STATUT_PAIEMENT[String(p.statut)] ?? {
                    label: String(p.statut ?? "—"),
                    cls: "bg-muted text-muted-foreground border-border",
                  };
                  return (
                    <tr key={p.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {fmtDate(p.paid_at ?? p.created_at)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                        {p.order_reference ?? "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        {MODE_LABELS[String(p.mode)] ?? String(p.mode ?? "—")}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                        {p.reference_transaction ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${st.cls}`}
                        >
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">{fmtMontant(p.montant)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <PiedPagination
            total={versements.length}
            premierIndex={versPremierIndex}
            nbAffiches={versementsPage.length}
            taille={versTaille}
            page={versPageCourante}
            nbPages={versNbPages}
            onTaille={(n) => {
              setVersTaille(n);
              setVersPage(1);
            }}
            onPage={setVersPage}
          />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Ce suivi reflète ce que la scolarité a enregistré. Un versement remis en main propre
        n&apos;apparaît qu&apos;une fois saisi ; en cas d&apos;écart, rapprochez-vous du service de
        scolarité.
      </p>
    </div>
  );
}

function Total({
  label,
  valeur,
  hint,
  icone,
  fond,
  couleur,
}: {
  label: string;
  valeur: string;
  hint: string;
  icone: React.ReactNode;
  fond: string;
  couleur?: string;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold ${couleur ?? "text-foreground"}`}>{valeur}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
          </div>
          <div className={`p-3 rounded-full shrink-0 ${fond}`}>{icone}</div>
        </div>
      </CardContent>
    </Card>
  );
}
