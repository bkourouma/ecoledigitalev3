"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  Wallet,
  Search,
  Layers,
  Loader2,
  CheckCircle2,
  CreditCard,
  X,
  Receipt,
  BookOpen,
  FileText,
  Calendar,
  ChevronDown,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ExportButtons } from "@/components/ExportButtons";
import { openPaiementsPdf } from "@/lib/utils/paiements-report";
import {
  useAllAdminEnrollments,
  useRecordStudentPayment,
  useEnrollmentsPaymentsHistory,
} from "@/lib/hooks/use-professional-suivi";
import { openReceiptPdf, type ReceiptData } from "@/lib/receipt-pdf";

/**
 * Paiements — Module Professionnel (admin).
 * Un étudiant = une carte (cumul de toutes ses UE d'une filière). Un premier
 * paiement (même partiel) confirme l'inscription ; on peut régler en plusieurs
 * fois jusqu'au solde, en voyant le reste à payer.
 */

const MODES = [
  { value: "especes", label: "Espèces" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "virement", label: "Virement bancaire" },
  { value: "autre", label: "Autre" },
];
const MODE_LABEL: Record<string, string> = Object.fromEntries(MODES.map((m) => [m.value, m.label]));

/** Libellés du filtre de règlement, repris tels quels dans l'export. */
const REGLEMENT_LABEL: Record<string, string> = {
  all: "Tous",
  non_regle: "Non réglés",
  partiel: "Partiels",
  solde: "Soldés",
};

function fmtFCFA(v?: number | null): string {
  return `${Math.round(Number(v ?? 0)).toLocaleString("fr-FR")} FCFA`;
}
function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("fr-FR");
}

/**
 * Année scolaire (pivot septembre) dérivée de la date de début de la session,
 * alignée sur le calcul côté API (professional-bulletin.service.ts) et les pages
 * Sessions / Inscrits : une session démarrant en septembre ou après appartient à
 * « AAAA-AAAA+1 », sinon « AAAA-1-AAAA ».
 */
function anneeScolaireOf(v?: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}
/**
 * Nom de la classe porté par une inscription : le libellé de la session,
 * amputé de son suffixe « — CODE UE ». C'est ce nom qu'on filtre, et non la
 * classe : une classe peut en porter plusieurs.
 */
function nomDeClasseOf(e: any): string {
  const lib = String(e.session_libelle ?? "").trim();
  const code = String(e.ue_code ?? "").trim();
  if (code && lib.endsWith(code)) {
    return lib.slice(0, lib.length - code.length).replace(/[\s—–-]+$/u, "").trim() || lib;
  }
  return lib;
}

/** Clé de sélection d'un nom de classe : « classe|nom ». */
function nomKeyOf(e: any): string {
  return `${e.filiere_id}|${nomDeClasseOf(e)}`;
}

const dueOf = (e: any) => Number(e.order_montant ?? e.prix_unitaire ?? 0);
const paidOf = (e: any) => Number(e.montant_paye ?? 0);

function stateOf(due: number, paid: number) {
  if (paid <= 0.5) return "non_regle";
  return due - paid <= 0.5 ? "solde" : "partiel";
}

/**
 * Libellé de session servant de regroupement : on retire le suffixe
 * « — <code UE> » du libellé pour n'afficher qu'une seule fois l'intitulé de la
 * session (ex. « Session Semestre 1 — L1IA-S1-UE2 » → « Session Semestre 1 »).
 */
function sessionGroupLabel(e: any): string {
  const lib = String(e.session_libelle ?? "").trim();
  const code = String(e.ue_code ?? "").trim();
  if (code && lib.endsWith(code)) {
    return lib.slice(0, lib.length - code.length).replace(/[\s—–-]+$/u, "").trim() || lib;
  }
  return lib || code;
}

/**
 * UE de « conduite » (ex. « Conduite (S1) ») : elle n'est pas prise en compte
 * côté paiements — ni affichée, ni comptée, ni facturée sur cette page.
 */
function isConduiteEnrollment(e: any): boolean {
  return String(e.ue_libelle ?? "").trim().toLowerCase().startsWith("conduite");
}

/** Regroupe les inscriptions d'un étudiant par libellé de session. */
function groupEnrollmentsBySession(enrollments: any[]): { label: string; items: any[] }[] {
  const groups = new Map<string, any[]>();
  for (const e of enrollments) {
    const key = sessionGroupLabel(e);
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

export default function ProfessionalPaiementsPage() {
  const query = useAllAdminEnrollments();
  const items: any[] = (query.data as any)?.items ?? [];

  const [nomKey, setNomKey] = useState("all");
  const [annee, setAnnee] = useState("all");
  const [semestreId, setSemestreId] = useState("all");
  const [reglement, setReglement] = useState("all");
  const [search, setSearch] = useState("");
  const [payGroup, setPayGroup] = useState<any | null>(null);

  // Noms de classe de l'année choisie : l'année commande la liste.
  const nomOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of items) {
      if (!e.filiere_id) continue;
      if (annee !== "all" && anneeScolaireOf(e.date_debut) !== annee) continue;
      map.set(nomKeyOf(e), nomDeClasseOf(e));
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [items, annee]);

  // Années scolaires disponibles (dérivées de la date de début des sessions),
  // adaptées à la filière sélectionnée. Plus récentes en premier.
  const anneeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of items) {
      const a = anneeScolaireOf(e.date_debut);
      if (a) set.add(a);
    }
    return Array.from(set)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: value }));
  }, [items]);

  // Semestres de l'année et du nom de classe retenus : dernier maillon de la
  // cascade année → nom de classe → semestre.
  const semestreOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of items) {
      if (!e.semestre_id) continue;
      if (annee !== "all" && anneeScolaireOf(e.date_debut) !== annee) continue;
      if (nomKey !== "all" && nomKeyOf(e) !== nomKey) continue;
      map.set(e.semestre_id, e.semestre_libelle ?? "Semestre");
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }));
  }, [items, annee, nomKey]);

  // Cumul par étudiant + filière (évite les doublons de nom).
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, any>();
    for (const e of items) {
      if (e.statut === "annulee") continue;
      if (isConduiteEnrollment(e)) continue; // Conduite exclue des paiements.
      if (nomKey !== "all" && nomKeyOf(e) !== nomKey) continue;
      if (annee !== "all" && anneeScolaireOf(e.date_debut) !== annee) continue;
      if (semestreId !== "all" && e.semestre_id !== semestreId) continue;
      const key = `${e.student_id}|${e.filiere_id}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          student_id: e.student_id,
          first_name: e.first_name,
          last_name: e.last_name,
          matricule: e.matricule,
          filiere_nom: e.filiere_nom,
          filiere_code: e.filiere_code,
          enrollments: [] as any[],
          due: 0,
          paid: 0,
        };
        map.set(key, g);
      }
      g.enrollments.push(e);
      g.due += dueOf(e);
      g.paid += paidOf(e);
    }
    let list = Array.from(map.values()).map((g) => ({
      ...g,
      reste: Math.max(0, g.due - g.paid),
      state: stateOf(g.due, g.paid),
      enrollment_ids: g.enrollments.map((e: any) => e.id),
    }));
    if (reglement !== "all") list = list.filter((g) => g.state === reglement);
    if (q)
      list = list.filter((g) =>
        `${g.first_name} ${g.last_name} ${g.matricule ?? ""}`.toLowerCase().includes(q)
      );
    return list.sort((a, b) =>
      `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
    );
  }, [items, nomKey, annee, semestreId, reglement, search]);

  // Changer d'année peut faire disparaître le nom retenu de la liste, et
  // changer de nom peut faire disparaître le semestre retenu.
  useEffect(() => {
    if (nomKey !== "all" && !nomOptions.some((o) => o.value === nomKey)) setNomKey("all");
  }, [nomOptions, nomKey]);
  useEffect(() => {
    if (semestreId !== "all" && !semestreOptions.some((o) => o.value === semestreId)) {
      setSemestreId("all");
    }
  }, [semestreOptions, semestreId]);

  const stats = useMemo(() => {
    let due = 0,
      paid = 0,
      confirmed = 0;
    for (const g of groups) {
      due += g.due;
      paid += g.paid;
      if (g.paid > 0) confirmed += 1;
    }
    return { due, paid, reste: Math.max(0, due - paid), count: groups.length, confirmed };
  }, [groups]);

  /** Périmètre exporté : exactement les cartes affichées, filtres compris. */
  const exportOptions = useMemo(
    () => ({
      annee: annee === "all" ? "Toutes les années" : annee,
      nomClasse:
        nomKey === "all"
          ? "Tous les noms de classe"
          : (nomOptions.find((o) => o.value === nomKey)?.label ?? nomKey),
      semestre:
        semestreId === "all"
          ? "Tous les semestres"
          : (semestreOptions.find((o) => o.value === semestreId)?.label ?? semestreId),
      reglement: REGLEMENT_LABEL[reglement] ?? reglement,
      recherche: search.trim() || undefined,
      stats,
    }),
    [annee, nomKey, nomOptions, semestreId, semestreOptions, reglement, search, stats]
  );

  if (query.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
            <Wallet className="h-7 w-7 text-indigo-500" />
            Paiements
          </h1>
          <p className="text-muted-foreground mt-2">
            Un étudiant = une carte (cumul de ses UE). Un premier paiement confirme l'inscription ;
            le reste à payer reste visible.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <ExportButtons
            formats={["pdf"]}
            disabled={groups.length === 0}
            onExportPdf={(win) => openPaiementsPdf(groups, exportOptions, win)}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Attendu" value={fmtFCFA(stats.due)} color="indigo" />
        <StatCard label="Encaissé" value={fmtFCFA(stats.paid)} color="green" />
        <StatCard label="Reste à payer" value={fmtFCFA(stats.reste)} color="amber" />
        <StatCard label="Étudiants" value={String(stats.count)} color="blue" />
        <StatCard label="Confirmés" value={String(stats.confirmed)} color="teal" />
      </div>

      {/* Filtres — cascade année → nom de classe → semestre, puis règlement,
          et la recherche seule sur sa ligne. */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
          {/* Rangée du haut : année scolaire, puis nom de classe */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SearchableSelect
              value={annee}
              onChange={setAnnee}
              icon={<Calendar className="h-4 w-4 text-gray-400" />}
              placeholder="Filtrer par année scolaire"
              searchPlaceholder="Rechercher une année…"
              options={[{ value: "all", label: "Toutes les années" }, ...anneeOptions]}
            />
            <SearchableSelect
              value={nomKey}
              onChange={setNomKey}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder="Filtrer par nom de classe"
              searchPlaceholder="Rechercher un nom de classe…"
              options={[{ value: "all", label: "Tous les noms de classe" }, ...nomOptions]}
            />
          </div>
          {/* Rangée du milieu : semestre + règlement */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SearchableSelect
              value={semestreId}
              onChange={setSemestreId}
              icon={<Calendar className="h-4 w-4 text-gray-400" />}
              placeholder="Filtrer par semestre"
              searchPlaceholder="Rechercher un semestre…"
              options={[{ value: "all", label: "Tous les semestres" }, ...semestreOptions]}
            />
            <Select value={reglement} onValueChange={setReglement}>
              <SelectTrigger>
                <SelectValue placeholder="Règlement" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="non_regle">Non réglés</SelectItem>
                <SelectItem value="partiel">Partiels</SelectItem>
                <SelectItem value="solde">Soldés</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* La recherche étudiant occupe sa propre ligne, pleine largeur. */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Étudiant…"
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Cartes étudiants */}
      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
            <div className="rounded-full bg-indigo-50 p-4">
              <Wallet className="h-8 w-8 text-indigo-500" />
            </div>
            <h3 className="text-lg font-semibold">Aucune inscription</h3>
            <p className="text-muted-foreground">Aucun étudiant ne correspond aux filtres.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {groups.map((g) => (
            <Card key={g.key} className="shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
              <div className="h-1.5 bg-gradient-to-r from-indigo-500 to-blue-500" />
              <CardContent className="p-5 flex flex-col gap-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground leading-snug">
                      {g.first_name} {g.last_name}
                    </h3>
                    {g.matricule && (
                      <span className="font-mono text-[11px] text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">
                        {g.matricule}
                      </span>
                    )}
                  </div>
                  <StateBadge state={g.state} />
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Layers className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {g.filiere_nom}
                    {g.filiere_code ? ` (${g.filiere_code})` : ""} · {g.enrollments.length} UE
                  </span>
                </div>

                {/* Montants cumulés */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-muted/40 p-2">
                    <p className="text-[11px] text-muted-foreground">Dû</p>
                    <p className="text-sm font-semibold">{fmtFCFA(g.due)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-2">
                    <p className="text-[11px] text-muted-foreground">Payé</p>
                    <p className="text-sm font-semibold text-green-600">{fmtFCFA(g.paid)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-2">
                    <p className="text-[11px] text-muted-foreground">Reste</p>
                    <p className="text-sm font-semibold text-amber-600">{fmtFCFA(g.reste)}</p>
                  </div>
                </div>

                {/* Sessions cumulées — chaque session est un accordéon repliable. */}
                <SessionAccordions enrollments={g.enrollments} />

                {g.reste <= 0.5 ? (
                  <Button
                    variant="outline"
                    className="w-full mt-auto border-green-300 text-green-700 hover:bg-green-50 hover:text-green-800"
                    onClick={() => setPayGroup(g)}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Voir les reçus
                  </Button>
                ) : (
                  <Button
                    className="w-full mt-auto bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white"
                    onClick={() => setPayGroup(g)}
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    Enregistrer un paiement
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {payGroup && <PaymentModal group={payGroup} onClose={() => setPayGroup(null)} />}
    </div>
  );
}

/**
 * Sessions cumulées d'un étudiant, chacune sous forme d'accordéon repliable.
 * Toutes les sessions sont réduites par défaut ; on clique sur l'en-tête pour
 * afficher les UE de la session.
 */
function SessionAccordions({ enrollments }: { enrollments: any[] }) {
  const sessions = useMemo(() => groupEnrollmentsBySession(enrollments), [enrollments]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div className="text-xs text-muted-foreground space-y-1">
      {sessions.map((grp) => {
        const isOpen = open[grp.label] ?? false;
        return (
          <div key={grp.label} className="rounded-md border border-border/60">
            <button
              type="button"
              onClick={() => setOpen((s) => ({ ...s, [grp.label]: !isOpen }))}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 font-medium text-foreground/80 hover:bg-muted/40 rounded-md"
            >
              <BookOpen className="h-3 w-3 shrink-0" />
              <span className="truncate flex-1 text-left">{grp.label}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{grp.items.length}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
            </button>
            {isOpen && (
              <ul className="ml-4 mr-2 mb-1.5 list-disc list-inside space-y-0.5">
                {grp.items.map((e: any) => (
                  <li key={e.id} className="truncate">
                    {e.ue_libelle || e.ue_code}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  if (state === "solde")
    return (
      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-medium">
        <CheckCircle2 className="h-3 w-3" /> Soldé
      </span>
    );
  if (state === "partiel")
    return (
      <span className="shrink-0 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-medium">
        Partiel
      </span>
    );
  return (
    <span className="shrink-0 rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium">
      Non réglé
    </span>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: "indigo" | "green" | "amber" | "blue" | "teal";
}) {
  const cls: Record<string, string> = {
    indigo: "from-indigo-500 to-indigo-600",
    green: "from-green-500 to-green-600",
    amber: "from-amber-500 to-orange-600",
    blue: "from-blue-500 to-blue-600",
    teal: "from-teal-500 to-teal-600",
  };
  return (
    <div className={`rounded-xl p-4 text-white bg-gradient-to-br ${cls[color]} shadow`}>
      <p className="text-white/80 text-xs font-medium">{label}</p>
      <p className="text-xl font-bold mt-1 leading-tight">{value}</p>
    </div>
  );
}

/* ------------------------------ Modale paiement ---------------------------- */

/**
 * Une transaction = l'ensemble des lignes de paiement partageant le même
 * horodatage (un règlement réparti sur plusieurs UE/commandes reste UNE
 * opération). `total_paye` est le cumul réglé jusqu'à cette transaction incluse.
 */
interface Txn {
  key: string;
  rows: any[];
  montant: number;
  total_paye: number;
  mode: string;
  reference: string | null;
  paid_at: string;
}

function buildTransactions(payments: any[]): Txn[] {
  const map = new Map<string, any[]>();
  for (const p of payments) {
    const key = String(p.paid_at ?? p.created_at ?? p.id);
    const arr = map.get(key);
    if (arr) arr.push(p);
    else map.set(key, [p]);
  }
  const list: Txn[] = Array.from(map.entries()).map(([key, rows]) => ({
    key,
    rows,
    montant: rows.reduce(
      (a, r) => a + (r.statut === "confirme" || r.statut == null ? Number(r.montant) : 0),
      0
    ),
    total_paye: 0,
    mode: rows[0]?.mode,
    reference: rows.find((r) => r.reference_transaction)?.reference_transaction ?? null,
    paid_at: key,
  }));
  list.sort((a, b) => new Date(a.paid_at).getTime() - new Date(b.paid_at).getTime());
  let cumul = 0;
  for (const t of list) {
    cumul += t.montant;
    t.total_paye = cumul;
  }
  return list;
}

/** N° de reçu affiché : le premier, avec « (+N) » si la transaction couvre plusieurs UE. */
function txnReceiptNumber(t: Txn): string {
  const nums = t.rows.map((r) => r.receipt_number).filter(Boolean);
  if (nums.length <= 1) return nums[0] ?? "—";
  return `${nums[0]} (+${nums.length - 1})`;
}

/**
 * Historique d'un semestre (session) : les UE concernées, le dû cumulé de la
 * session et ses transactions de paiement propres. Sert à « dispatcher » les
 * reçus par semestre — chaque paiement (donc chaque reçu) étant rattaché à un
 * ordre unique, on sait à quel semestre il appartient.
 */
interface SessionHistory {
  label: string | null;
  ues: any[];
  due: number;
  transactions: Txn[];
}

/**
 * Répartit les paiements d'un lot par semestre (session), via
 * `paiement.order_id → inscription → session`. Chaque inscription possède son
 * propre ordre (1 UE = 1 ordre), donc chaque reçu est rattachable à un semestre.
 * Repli : si l'API ne renvoie pas encore `order_id`, on regroupe tout dans un
 * seul bloc (comportement historique).
 */
function buildSessionHistories(group: any, payments: any[]): SessionHistory[] {
  const sessions = groupEnrollmentsBySession(group.enrollments);
  const orderToLabel = new Map<string, string>();
  let hasOrderIds = false;
  for (const s of sessions)
    for (const e of s.items)
      if (e.order_id) {
        orderToLabel.set(String(e.order_id), s.label);
        hasOrderIds = true;
      }

  if (!hasOrderIds) {
    return [{ label: null, ues: group.enrollments, due: group.due, transactions: buildTransactions(payments) }];
  }

  const bySession = new Map<string, any[]>();
  const unmatched: any[] = [];
  for (const p of payments) {
    const label = orderToLabel.get(String(p.order_id));
    if (!label) {
      unmatched.push(p);
      continue;
    }
    const arr = bySession.get(label);
    if (arr) arr.push(p);
    else bySession.set(label, [p]);
  }

  const out: SessionHistory[] = sessions.map((s) => ({
    label: s.label,
    ues: s.items,
    due: s.items.reduce((a: number, e: any) => a + dueOf(e), 0),
    transactions: buildTransactions(bySession.get(s.label) ?? []),
  }));
  if (unmatched.length) {
    out.push({
      label: "Autres paiements",
      ues: group.enrollments,
      due: group.due,
      transactions: buildTransactions(unmatched),
    });
  }
  return out;
}

function buildReceiptData(
  group: any,
  t: Txn,
  scope: { ues: any[]; total_du: number }
): ReceiptData {
  return {
    receipt_number: txnReceiptNumber(t),
    reference_transaction: t.reference,
    montant: t.montant,
    mode: t.mode,
    paid_at: t.paid_at,
    student: {
      first_name: group.first_name,
      last_name: group.last_name,
      matricule: group.matricule,
    },
    filiere: { nom: group.filiere_nom, code: group.filiere_code },
    total_du: scope.total_du,
    total_paye: t.total_paye,
    ues: scope.ues.map((e: any) => ({
      libelle: e.ue_libelle,
      code: e.ue_code,
      montant: dueOf(e),
    })),
  };
}

function PaymentModal({ group, onClose }: { group: any; onClose: () => void }) {
  const historyQuery = useEnrollmentsPaymentsHistory(group.enrollment_ids);
  const recordMut = useRecordStudentPayment();
  const payments: any[] = (historyQuery.data as any)?.payments ?? [];

  // Totaux "live" : recalculés depuis l'historique si dispo, sinon depuis le groupe.
  const paidLive = payments.length
    ? payments.reduce((a, p) => a + (p.statut === "confirme" ? Number(p.montant) : 0), 0)
    : group.paid;
  const due = group.due;
  const reste = Math.max(0, due - paidLive);

  const [montant, setMontant] = useState<string>("");
  const [mode, setMode] = useState("especes");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Historique dispatché par semestre (session) : chaque reçu est rattaché à
  // son semestre via l'ordre de paiement.
  const sessionHistories = useMemo(
    () => buildSessionHistories(group, payments),
    [group, payments]
  );
  const hasAnyPayment = sessionHistories.some((sh) => sh.transactions.length > 0);

  async function submit() {
    setError(null);
    const m = Number(montant);
    if (!(m > 0)) return setError("Montant invalide.");
    if (m > reste + 0.5) return setError(`Le montant dépasse le reste (${fmtFCFA(reste)}).`);
    // Onglet ouvert de façon synchrone (geste utilisateur) pour éviter le blocage popup.
    const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
    try {
      await recordMut.mutateAsync({
        enrollmentIds: group.enrollment_ids,
        montant: m,
        mode,
        reference_transaction: reference || undefined,
      });
      setMontant("");
      setReference("");
      const res = await historyQuery.refetch();
      const fresh: any[] = (res.data as any)?.payments ?? [];
      // Le paiement peut couvrir plusieurs semestres : on ouvre un reçu par
      // semestre nouvellement crédité (même horodatage = la transaction du jour).
      const histories = buildSessionHistories(group, fresh);
      const newest = Math.max(
        0,
        ...fresh.map((p) => new Date(p.paid_at ?? p.created_at ?? 0).getTime())
      );
      const touched = histories
        .map((sh) => ({ sh, t: sh.transactions.find((t) => new Date(t.paid_at).getTime() === newest) }))
        .filter((x): x is { sh: SessionHistory; t: Txn } => Boolean(x.t));
      if (touched.length) {
        await openReceiptPdf(
          buildReceiptData(group, touched[0].t, { ues: touched[0].sh.ues, total_du: touched[0].sh.due }),
          win
        );
        // Semestres supplémentaires : nouveaux onglets (meilleur effort).
        for (let k = 1; k < touched.length; k++) {
          void openReceiptPdf(
            buildReceiptData(group, touched[k].t, {
              ues: touched[k].sh.ues,
              total_du: touched[k].sh.due,
            })
          );
        }
      } else win?.close();
    } catch (e: any) {
      win?.close();
      setError(e?.message ?? "Paiement refusé.");
    }
  }

  function openReceipt(sh: SessionHistory, t: Txn) {
    const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
    void openReceiptPdf(buildReceiptData(group, t, { ues: sh.ues, total_du: sh.due }), win);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-lg font-semibold">
            Paiement — {group.first_name} {group.last_name}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            {group.filiere_nom}
            {group.filiere_code ? ` (${group.filiere_code})` : ""} · {group.enrollments.length} UE
          </p>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-border p-2">
              <p className="text-xs text-muted-foreground">Dû</p>
              <p className="font-semibold">{fmtFCFA(due)}</p>
            </div>
            <div className="rounded-lg border border-border p-2">
              <p className="text-xs text-muted-foreground">Payé</p>
              <p className="font-semibold text-green-600">{fmtFCFA(paidLive)}</p>
            </div>
            <div className="rounded-lg border border-border p-2">
              <p className="text-xs text-muted-foreground">Reste</p>
              <p className="font-semibold text-amber-600">{fmtFCFA(reste)}</p>
            </div>
          </div>

          {/* Détail par UE */}
          <div className="rounded-lg border border-border divide-y">
            {group.enrollments.map((e: any) => {
              const d = dueOf(e);
              const p = paidOf(e);
              return (
                <div key={e.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{e.ue_libelle || e.ue_code}</span>
                  </span>
                  <span className="text-muted-foreground whitespace-nowrap">
                    {fmtFCFA(p)} / {fmtFCFA(d)}
                  </span>
                </div>
              );
            })}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {reste <= 0.5 ? (
            <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" /> Ce lot est entièrement réglé.
            </div>
          ) : (
            <div className="rounded-lg border border-border p-4 space-y-3">
              <p className="text-sm font-medium">Nouveau paiement</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Montant (FCFA)</label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={1}
                      value={montant}
                      onChange={(e) => setMontant(e.target.value)}
                      placeholder={String(Math.round(reste))}
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
                <div className="space-y-1">
                  <label className="text-xs font-medium">Mode</label>
                  <Select value={mode} onValueChange={setMode}>
                    <SelectTrigger>
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
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Référence (optionnel)</label>
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="N° de transaction / reçu"
                />
              </div>
              <Button
                onClick={submit}
                disabled={recordMut.isPending}
                className="w-full bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white"
              >
                {recordMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Receipt className="h-4 w-4 mr-2" />
                )}
                Enregistrer le paiement
              </Button>
            </div>
          )}

          {/* Historique — reçus dispatchés par semestre (session). */}
          <div>
            <p className="text-sm font-medium mb-2">Historique des paiements</p>
            {historyQuery.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : !hasAnyPayment ? (
              <p className="text-sm text-muted-foreground">Aucun paiement enregistré.</p>
            ) : (
              <div className="space-y-3">
                {sessionHistories
                  .filter((sh) => sh.transactions.length > 0)
                  .map((sh) => {
                    const paid = sh.transactions.reduce((a, t) => a + t.montant, 0);
                    return (
                      <div key={sh.label ?? "__all"} className="rounded-lg border border-border overflow-hidden">
                        <div className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2">
                          <span className="flex items-center gap-1.5 font-medium text-sm min-w-0">
                            <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{sh.label ?? "Paiements"}</span>
                          </span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                            {fmtFCFA(paid)} / {fmtFCFA(sh.due)}
                          </span>
                        </div>
                        <ul className="divide-y divide-border">
                          {[...sh.transactions].reverse().map((t) => (
                            <li
                              key={t.key}
                              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                            >
                              <div className="min-w-0">
                                <span className="font-medium">{fmtFCFA(t.montant)}</span>{" "}
                                <span className="text-muted-foreground">
                                  · {MODE_LABEL[t.mode] ?? t.mode}
                                </span>
                                <div className="text-xs text-muted-foreground truncate">
                                  {txnReceiptNumber(t)} · {fmtDate(t.paid_at)}
                                </div>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="shrink-0"
                                onClick={() => openReceipt(sh, t)}
                                title="Éditer le reçu de paiement (PDF)"
                              >
                                <FileText className="h-4 w-4 mr-1.5" />
                                Reçu
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
