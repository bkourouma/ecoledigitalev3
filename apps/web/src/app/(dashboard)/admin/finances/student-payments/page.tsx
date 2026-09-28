"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ecoledigitale/ui";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  FileText,
  GraduationCap,
  Loader2,
  Receipt,
  Search,
  Users,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { openReceiptPdf } from "@/lib/receipt-pdf";
import {
  buildReceipt,
  buildTransactions,
  fmtFCFA,
  fmtDate,
  libelleLigne,
  nomComplet,
  numeroRecu,
  type Transaction,
} from "@/lib/scolarite-paiements";
import {
  LIGNES,
  MODES,
  MODE_LABEL,
  useRecordLotPayment,
  useScolariteLot,
  useScolariteLots,
  type LigneKey,
  type LotDetail,
} from "@/lib/hooks/use-scolarite-paiements";

/**
 * Paiements étudiants — barème complet.
 *
 * Un étudiant sur une classe forme un LOT, qui doit le barème de cette classe
 * (/admin/finances/scolarite) : inscription, scolarité, frais annexes, autres
 * frais. Les UE suivies alimentent la ligne scolarité. L'encaissement reprend
 * le modèle du module professionnel — règlement partiel, mode, référence, et un
 * reçu PDF par transaction.
 *
 * Couleurs : ne PAS utiliser les variantes `dark:`. La palette sombre est portée
 * par `:root` dans globals.css, et il n'existe aucun bloc `.light` — l'interface
 * est donc sombre quel que soit le thème, alors que `dark:` ne s'active que si
 * ThemeProvider a posé la classe `dark` (pas le cas quand le système est en
 * clair). Un `bg-<couleur>-50 dark:bg-<couleur>-950` donne alors un fond clair
 * sous un texte clair. Utiliser des teintes translucides (`bg-indigo-500/15`),
 * qui se posent sur la surface du thème sans la remplacer.
 */

const TOUS = "all";

const ETAT_LABEL: Record<string, string> = {
  all: "Tous",
  non_regle: "Non réglés",
  partiel: "Partiels",
  solde: "Soldés",
};

export default function AdminStudentPaymentsPage() {
  const [classeId, setClasseId] = useState(TOUS);
  const [etat, setEtat] = useState(TOUS);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ studentId: string; programmeId: string } | null>(null);

  const { data: lotsData, isLoading, error } = useScolariteLots();

  const lots = useMemo(() => lotsData ?? [], [lotsData]);

  /*
   * Classes proposées au filtre. Deux motifs de présence, le second l'emportant
   * sur tout le reste :
   *
   *   1. la classe est ENCORE OUVERTE sur l'écran Sessions (`classeOuverte`,
   *      calculé par l'API sur le statut des ouvertures) ;
   *   2. OU il reste de l'argent à encaisser dessus — un seul étudiant non
   *      soldé suffit.
   *
   * Une classe ne sort donc de la liste qu'une fois son cursus terminé ET tous
   * ses étudiants à jour : on ne peut jamais perdre de vue un impayé.
   *
   * La condition « au moins une inscription » est structurelle : un lot n'existe
   * que si l'étudiant est inscrit.
   */
  const classeOptions = useMemo(() => {
    const avecImpaye = new Set<string>();
    for (const l of lots) {
      if (l.reste > 0.5) avecImpaye.add(l.programmeId);
    }

    const retenues = new Map<string, string>();
    for (const l of lots) {
      if (l.classeOuverte || avecImpaye.has(l.programmeId)) {
        retenues.set(l.programmeId, l.classeNom);
      }
    }

    return [
      { value: TOUS, label: "Toutes les classes" },
      ...[...retenues.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    ];
  }, [lots]);

  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lots.filter((l) => {
      if (classeId !== TOUS && l.programmeId !== classeId) return false;
      if (etat !== TOUS && l.etat !== etat) return false;
      if (!q) return true;
      return `${nomComplet(l)} ${l.matricule ?? ""}`.toLowerCase().includes(q);
    });
  }, [lots, classeId, etat, search]);

  const stats = useMemo(
    () =>
      visibles.reduce(
        (a, l) => ({
          du: a.du + l.du,
          paye: a.paye + l.paye,
          reste: a.reste + l.reste,
          soldes: a.soldes + (l.etat === "solde" ? 1 : 0),
        }),
        { du: 0, paye: 0, reste: 0, soldes: 0 }
      ),
    [visibles]
  );

  // L'étudiant retenu doit rester visible ; sinon le panneau de droite parlerait
  // de quelqu'un qui n'est plus dans la liste.
  useEffect(() => {
    if (!selected) return;
    const encore = visibles.some(
      (l) => l.studentId === selected.studentId && l.programmeId === selected.programmeId
    );
    if (!encore) setSelected(null);
  }, [visibles, selected]);

  return (
    <div className="container mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
          Paiements étudiants
        </h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
          Barème complet de la classe : inscription, scolarité, frais annexes et autres frais.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total des frais" value={fmtFCFA(stats.du)} color="indigo" />
        <StatCard label="Encaissé" value={fmtFCFA(stats.paye)} color="green" />
        <StatCard label="Reste à payer" value={fmtFCFA(stats.reste)} color="amber" />
        <StatCard label="Soldés" value={`${stats.soldes} / ${visibles.length}`} color="blue" />
      </div>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SearchableSelect
              value={classeId}
              onChange={setClasseId}
              options={classeOptions}
              icon={<GraduationCap className="h-4 w-4 text-muted-foreground" />}
              placeholder="Toutes les classes"
              searchPlaceholder="Rechercher une classe..."
            />
            <Select value={etat} onValueChange={setEtat}>
              <SelectTrigger>
                <SelectValue placeholder="Règlement" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ETAT_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un étudiant par nom ou matricule..."
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center gap-2 font-semibold">
              <Users className="h-5 w-5" />
              Étudiants
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {visibles.length}
              </span>
            </div>

            {isLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement...
              </div>
            ) : visibles.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Aucun étudiant ne correspond aux filtres.
              </p>
            ) : (
              <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
                {visibles.map((lot) => {
                  const actif =
                    selected?.studentId === lot.studentId &&
                    selected?.programmeId === lot.programmeId;
                  return (
                    <button
                      key={`${lot.studentId}|${lot.programmeId}`}
                      onClick={() =>
                        setSelected({ studentId: lot.studentId, programmeId: lot.programmeId })
                      }
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        actif
                          ? "border-indigo-500 bg-indigo-500/15 ring-1 ring-indigo-500/40"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <div className="truncate text-sm font-semibold text-foreground">
                        {nomComplet(lot)}
                      </div>
                      <div className="mt-1 text-xs">
                        <span className="text-muted-foreground">Reste </span>
                        <span className="font-medium text-amber-600">{fmtFCFA(lot.reste)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          {selected ? (
            <LotPanel studentId={selected.studentId} programmeId={selected.programmeId} />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                <div className="rounded-full bg-indigo-500/15 p-4">
                  <Receipt className="h-8 w-8 text-indigo-500" />
                </div>
                <h3 className="text-lg font-semibold">Aucun étudiant sélectionné</h3>
                <p className="text-muted-foreground">
                  Choisissez un étudiant à gauche pour voir sa situation et encaisser.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------- Panneau d'un étudiant -------------------------- */

function LotPanel({ studentId, programmeId }: { studentId: string; programmeId: string }) {
  const { data: lot, isLoading, error, refetch } = useScolariteLot(studentId, programmeId);
  const [ligneAEncaisser, setLigneAEncaisser] = useState<LigneKey | null>(null);

  const transactions = useMemo(() => buildTransactions(lot?.payments ?? []), [lot?.payments]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement de la situation...
        </CardContent>
      </Card>
    );
  }

  if (error || !lot) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          {(error as Error)?.message ?? "Situation introuvable pour cet étudiant."}
        </AlertDescription>
      </Alert>
    );
  }

  function ouvrirRecu(t: Transaction) {
    const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
    void openReceiptPdf(buildReceipt(lot!, t), win);
  }

  /**
   * Après encaissement : on relit la situation et on édite le reçu de la
   * transaction qui vient d'être créée, dans l'onglet déjà ouvert par le clic
   * (sans quoi le navigateur le bloquerait).
   */
  async function ouvrirRecuDuDernierPaiement(win: Window | null) {
    const { data: frais } = await refetch();
    if (!frais) {
      win?.close();
      return;
    }
    const derniere = buildTransactions(frais.payments).at(-1);
    if (!derniere) {
      win?.close();
      return;
    }
    void openReceiptPdf(buildReceipt(frais, derniere), win);
  }

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold">{nomComplet(lot)}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {lot.matricule ? (
                <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[11px] text-indigo-500">
                  {lot.matricule}
                </span>
              ) : null}
              <Badge variant="outline">{lot.classeNom}</Badge>
              <EtatBadge etat={lot.etat} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Total label="Total des frais" value={fmtFCFA(lot.du)} />
          <Total label="Total payé" value={fmtFCFA(lot.paye)} tone="text-green-600" />
          <Total label="Reste à payer" value={fmtFCFA(lot.reste)} tone="text-amber-600" />
        </div>

        <Tabs defaultValue="bareme">
          <TabsList>
            <TabsTrigger value="bareme">Barème</TabsTrigger>
            <TabsTrigger value="ue">UE suivies ({lot.ues.length})</TabsTrigger>
            <TabsTrigger value="transactions">Transactions ({transactions.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="bareme" className="space-y-3 pt-3">
            {LIGNES.map(({ key, label }) => {
              const m = lot.lignes[key];
              const part = m.du > 0 ? Math.min(100, (m.paye / m.du) * 100) : 0;
              const solde = m.du > 0 && m.reste <= 0.5;

              return (
                <div key={key} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{label}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">
                        {fmtFCFA(m.paye)} / {fmtFCFA(m.du)}
                      </span>
                      {m.du <= 0 ? (
                        <Badge variant="outline">Non applicable</Badge>
                      ) : solde ? (
                        <Badge className="border-green-200 bg-green-100 text-green-800">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Réglé
                        </Badge>
                      ) : (
                        <Button size="sm" onClick={() => setLigneAEncaisser(key)}>
                          <CreditCard className="mr-1.5 h-3.5 w-3.5" />
                          Encaisser
                        </Button>
                      )}
                    </div>
                  </div>
                  {m.du > 0 ? (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${solde ? "bg-green-500" : "bg-indigo-500"}`}
                        style={{ width: `${part}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="ue" className="space-y-2 pt-3">
            {lot.ues.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune inscription à une UE pour cette classe.
              </p>
            ) : (
              <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
                {groupeParSemestre(lot.ues).map((groupe) => (
                  <SemestreAccordeon key={groupe.cle} groupe={groupe} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="transactions" className="space-y-2 pt-3">
            {transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun paiement enregistré.</p>
            ) : (
              <div className="max-h-[320px] divide-y overflow-auto rounded-lg border">
                {[...transactions].reverse().map((t) => (
                  <div key={t.key} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm">
                        <span className="font-medium">{fmtFCFA(t.montant)}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {libelleLigne(t.ligne)} · {MODE_LABEL[t.mode] ?? t.mode}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {numeroRecu(t)} · {fmtDate(t.paidAt)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => ouvrirRecu(t)}
                    >
                      <FileText className="mr-1.5 h-4 w-4" />
                      Reçu
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      {ligneAEncaisser ? (
        <EncaisserDialog
          lot={lot}
          ligne={ligneAEncaisser}
          onClose={() => setLigneAEncaisser(null)}
          onPaid={ouvrirRecuDuDernierPaiement}
        />
      ) : null}
    </Card>
  );
}

/* ---------------------------- Modale d'encaissement ------------------------ */

function EncaisserDialog({
  lot,
  ligne,
  onClose,
  onPaid,
}: {
  lot: LotDetail;
  ligne: LigneKey;
  onClose: () => void;
  onPaid: (win: Window | null) => Promise<void>;
}) {
  const record = useRecordLotPayment();
  const reste = lot.lignes[ligne]?.reste ?? 0;

  const [montant, setMontant] = useState<string>(String(Math.round(reste)));
  const [mode, setMode] = useState<string>("especes");
  const [reference, setReference] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  const label = libelleLigne(ligne);

  async function valider() {
    setErreur(null);
    const m = Number(montant);
    if (!(m > 0)) return setErreur("Le montant doit être supérieur à 0.");
    if (m > reste + 0.5) return setErreur(`Le montant dépasse le reste (${fmtFCFA(reste)}).`);

    // Onglet ouvert de façon synchrone, dans le geste de l'utilisateur : sinon
    // le navigateur bloque la fenêtre du reçu.
    const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
    try {
      await record.mutateAsync({
        studentId: lot.studentId,
        programmeId: lot.programmeId,
        ligne,
        montant: m,
        mode,
        reference_transaction: reference || undefined,
      });
      onClose();
      await onPaid(win);
    } catch (e: any) {
      win?.close();
      setErreur(e?.message ?? "Paiement refusé.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encaisser — {label}</DialogTitle>
          <DialogDescription>
            {nomComplet(lot)} · {lot.classeNom} · reste {fmtFCFA(reste)}
          </DialogDescription>
        </DialogHeader>

        {erreur ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{erreur}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground">Montant (FCFA)</label>
            <div className="mt-1 flex gap-2">
              <Input
                type="number"
                min={1}
                value={montant}
                onChange={(e) => setMontant(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setMontant(String(Math.round(reste)))}
                title="Tout le reste"
              >
                Tout
              </Button>
            </div>
          </div>

          <div>
            <label className="text-sm text-muted-foreground">Mode de règlement</label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm text-muted-foreground">Référence (optionnel)</label>
            <Input
              className="mt-1"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="N° de transaction"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={record.isPending}>
            Annuler
          </Button>
          <Button onClick={valider} disabled={record.isPending}>
            {record.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Receipt className="mr-2 h-4 w-4" />
            )}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- UE par semestre ----------------------------- */

type UeSuivie = LotDetail["ues"][number];

interface GroupeSemestre {
  cle: string;
  libelle: string;
  ues: UeSuivie[];
  montant: number;
}

/**
 * Regroupe les UE suivies par semestre, dans l'ordre des libellés. Une cohorte
 * rattachée à aucun semestre atterrit dans un groupe à part plutôt que d'être
 * escamotée.
 */
function groupeParSemestre(ues: UeSuivie[]): GroupeSemestre[] {
  const groupes = new Map<string, GroupeSemestre>();

  for (const ue of ues) {
    const cle = ue.semestre_id ?? "__sans_semestre";
    let groupe = groupes.get(cle);
    if (!groupe) {
      groupe = { cle, libelle: ue.semestre_libelle ?? "Hors semestre", ues: [], montant: 0 };
      groupes.set(cle, groupe);
    }
    groupe.ues.push(ue);
    groupe.montant += Number(ue.montant);
  }

  return [...groupes.values()].sort((a, b) => {
    if (a.cle === "__sans_semestre") return 1;
    if (b.cle === "__sans_semestre") return -1;
    return a.libelle.localeCompare(b.libelle, "fr", { numeric: true });
  });
}

/** Un semestre repliable : en-tête cliquable, UE à l'intérieur. */
function SemestreAccordeon({ groupe }: { groupe: GroupeSemestre }) {
  const [ouvert, setOuvert] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left hover:bg-muted/60"
      >
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{groupe.libelle}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {groupe.ues.length} UE · {fmtFCFA(groupe.montant)}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            ouvert ? "rotate-180" : ""
          }`}
        />
      </button>

      {ouvert ? (
        <div className="divide-y">
          {groupe.ues.map((ue) => (
            <div key={ue.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate pl-5 text-sm">{ue.ue_libelle || ue.ue_code}</span>
              <span className="whitespace-nowrap text-sm text-muted-foreground">
                {fmtFCFA(ue.montant)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------- Bricoles -------------------------------- */

function EtatBadge({ etat }: { etat: string }) {
  if (etat === "solde") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        <CheckCircle2 className="h-3 w-3" /> Soldé
      </span>
    );
  }
  if (etat === "partiel") {
    return (
      <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
        Partiel
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
      Non réglé
    </span>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: "indigo" | "green" | "amber" | "blue";
}) {
  const cls: Record<string, string> = {
    indigo: "from-indigo-500 to-indigo-600",
    green: "from-green-500 to-green-600",
    amber: "from-amber-500 to-orange-600",
    blue: "from-blue-500 to-blue-600",
  };
  return (
    <div className={`rounded-xl bg-gradient-to-br p-4 text-white shadow ${cls[color]}`}>
      <p className="text-xs font-medium text-white/80">{label}</p>
      <p className="mt-1 text-xl font-bold leading-tight">{value}</p>
    </div>
  );
}
