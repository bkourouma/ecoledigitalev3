"use client";

import { useMemo, useState } from "react";
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
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import {
  useAdminEnrollments,
  useRecordStudentPayment,
  useEnrollmentsPaymentsHistory,
} from "@/lib/hooks/use-professional-suivi";

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

function fmtFCFA(v?: number | null): string {
  return `${Math.round(Number(v ?? 0)).toLocaleString("fr-FR")} FCFA`;
}
function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("fr-FR");
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
  const query = useAdminEnrollments({ pageSize: 500 });
  const items: any[] = (query.data as any)?.items ?? [];

  const [filiere, setFiliere] = useState("all");
  const [reglement, setReglement] = useState("all");
  const [search, setSearch] = useState("");
  const [payGroup, setPayGroup] = useState<any | null>(null);

  const filiereOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of items)
      if (e.filiere_id) map.set(e.filiere_id, `${e.filiere_nom ?? e.filiere_code} (${e.filiere_code})`);
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  // Cumul par étudiant + filière (évite les doublons de nom).
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, any>();
    for (const e of items) {
      if (e.statut === "annulee") continue;
      if (isConduiteEnrollment(e)) continue; // Conduite exclue des paiements.
      if (filiere !== "all" && e.filiere_id !== filiere) continue;
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
  }, [items, filiere, reglement, search]);

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

  if (query.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
          <Wallet className="h-7 w-7 text-indigo-500" />
          Paiements
        </h1>
        <p className="text-muted-foreground mt-2">
          Un étudiant = une carte (cumul de ses UE). Un premier paiement confirme l'inscription ; le
          reste à payer reste visible.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Attendu" value={fmtFCFA(stats.due)} color="indigo" />
        <StatCard label="Encaissé" value={fmtFCFA(stats.paid)} color="green" />
        <StatCard label="Reste à payer" value={fmtFCFA(stats.reste)} color="amber" />
        <StatCard label="Étudiants" value={String(stats.count)} color="blue" />
        <StatCard label="Confirmés" value={String(stats.confirmed)} color="teal" />
      </div>

      {/* Filtres — filière large, recherche réduite */}
      <Card className="shadow-sm">
        <CardContent className="p-4 flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="flex-1 min-w-0">
            <SearchableSelect
              value={filiere}
              onChange={setFiliere}
              icon={<Layers className="h-4 w-4 text-gray-400" />}
              placeholder="Filtrer par filière"
              searchPlaceholder="Rechercher une filière…"
              options={[{ value: "all", label: "Toutes les filières" }, ...filiereOptions]}
            />
          </div>
          <div className="lg:w-48">
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
          <div className="relative lg:w-56">
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

                {/* Sessions cumulées — libellé de session une fois, puis les UE par nom. */}
                <div className="text-xs text-muted-foreground space-y-1.5">
                  {groupEnrollmentsBySession(g.enrollments).map((grp) => (
                    <div key={grp.label}>
                      <p className="flex items-center gap-1.5 font-medium text-foreground/80">
                        <BookOpen className="h-3 w-3 shrink-0" />
                        <span className="truncate">{grp.label}</span>
                      </p>
                      <ul className="mt-0.5 ml-4 list-disc list-inside space-y-0.5">
                        {grp.items.map((e: any) => (
                          <li key={e.id} className="truncate">
                            {e.ue_libelle || e.ue_code}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <Button
                  className="w-full mt-auto bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white disabled:opacity-60"
                  disabled={g.reste <= 0.5}
                  onClick={() => setPayGroup(g)}
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  {g.reste <= 0.5 ? "Soldé" : "Enregistrer un paiement"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {payGroup && <PaymentModal group={payGroup} onClose={() => setPayGroup(null)} />}
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

  async function submit() {
    setError(null);
    const m = Number(montant);
    if (!(m > 0)) return setError("Montant invalide.");
    if (m > reste + 0.5) return setError(`Le montant dépasse le reste (${fmtFCFA(reste)}).`);
    try {
      await recordMut.mutateAsync({
        enrollmentIds: group.enrollment_ids,
        montant: m,
        mode,
        reference_transaction: reference || undefined,
      });
      setMontant("");
      setReference("");
      historyQuery.refetch();
    } catch (e: any) {
      setError(e?.message ?? "Paiement refusé.");
    }
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

          {/* Historique */}
          <div>
            <p className="text-sm font-medium mb-2">Historique des paiements</p>
            {historyQuery.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun paiement enregistré.</p>
            ) : (
              <ul className="space-y-1.5">
                {payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium">{fmtFCFA(p.montant)}</span>{" "}
                      <span className="text-muted-foreground">· {MODE_LABEL[p.mode] ?? p.mode}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.receipt_number} · {fmtDate(p.paid_at ?? p.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
