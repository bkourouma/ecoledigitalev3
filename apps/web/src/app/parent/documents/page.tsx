"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  Button,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  FileText,
  FileSpreadsheet,
  Receipt,
  Users,
  Loader2,
  AlertCircle,
  ExternalLink,
  X,
  Wallet,
  CheckCircle2,
} from "lucide-react";
import {
  useProfessionalChildren,
  useChildBulletinSemestres,
  useChildBulletin,
  useChildProfessionalPayments,
} from "@/lib/hooks/use-professional-parent";
import { allBulletinsPdfObjectUrl } from "@/lib/bulletin-pdf";
import { receiptPdfObjectUrl, type ReceiptData } from "@/lib/receipt-pdf";
import { semestreLabelShort } from "@/lib/bulletin-format";
import { useFiltresScolaires } from "@/components/FiltresScolaires";

/**
 * Bulletins & Reçus — espace parent (Module Professionnel, feature 030).
 * Reprend les documents officiels des pages admin :
 *  - Bulletins : le relevé de notes PDF de /professionnel/admin/bulletins ;
 *  - Reçus : les reçus de paiement PDF de /professionnel/admin/paiements.
 * Documents générés par les mêmes libs (bulletin-pdf / receipt-pdf) → identiques.
 */

const MODE_LABEL: Record<string, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  virement: "Virement bancaire",
  autre: "Autre",
};

function fmtFCFA(v?: number | null): string {
  return `${Math.round(Number(v ?? 0)).toLocaleString("fr-FR")} FCFA`;
}
function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("fr-FR");
}
function childName(c: any): string {
  return `${c?.first_name ?? ""} ${c?.last_name ?? ""}`.trim() || "Enfant";
}

export default function ParentDocumentsPage() {
  const { data: session, status } = useSession();
  const childrenQuery = useProfessionalChildren();
  const children: any[] = (childrenQuery.data as any[]) ?? [];
  const [childId, setChildId] = useState<string>("");
  const [tab, setTab] = useState<"bulletins" | "recus">("bulletins");

  useEffect(() => {
    if (!childId && children.length > 0) setChildId(children[0].id);
  }, [children, childId]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-emerald-500" />
      </div>
    );
  }
  if (!session) {
    redirect("/login");
  }
  const roles = (session as any)?.roles ?? [];
  if (!(Array.isArray(roles) && roles.some((r: string) => ["parent", "Parent"].includes(r)))) {
    redirect("/");
  }

  const selectedChild = children.find((c) => c.id === childId);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/80 shadow-sm backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/15 p-2">
              <FileText className="h-8 w-8 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Bulletins & Reçus</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Relevés de notes et reçus de paiement officiels de votre enfant,
                en consultation.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Pour obtenir un exemplaire, adressez-vous au service de scolarité.
              </p>
            </div>
          </div>
          {children.length > 1 && (
            <div className="w-full sm:w-72">
              <Select value={childId} onValueChange={setChildId}>
                <SelectTrigger>
                  <Users className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="Choisir un enfant" />
                </SelectTrigger>
                <SelectContent>
                  {children.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {childName(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {childrenQuery.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          </div>
        ) : childrenQuery.isError ? (
          <Card>
            <CardContent className="p-6 text-center">
              <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">
                {(childrenQuery.error as Error)?.message ?? "Impossible de charger vos enfants."}
              </p>
              <Button onClick={() => childrenQuery.refetch()}>Réessayer</Button>
            </CardContent>
          </Card>
        ) : children.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              Aucun enfant n'est rattaché à votre compte.
            </CardContent>
          </Card>
        ) : (
          <>
            {selectedChild && children.length > 1 && (
              <p className="mb-4 text-sm text-muted-foreground">
                Documents de{" "}
                <span className="font-semibold text-foreground">{childName(selectedChild)}</span>
              </p>
            )}

            {/* Onglets */}
            <div className="border-b border-border mb-6">
              <nav className="flex gap-2">
                <TabButton active={tab === "bulletins"} onClick={() => setTab("bulletins")}>
                  <FileSpreadsheet className="h-4 w-4" />
                  Bulletins
                </TabButton>
                <TabButton active={tab === "recus"} onClick={() => setTab("recus")}>
                  <Receipt className="h-4 w-4" />
                  Reçus de paiement
                </TabButton>
              </nav>
            </div>

            {tab === "bulletins" ? (
              <BulletinsTab childId={childId} />
            ) : (
              <ReceiptsTab childId={childId} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-emerald-500 text-emerald-500"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/* -------------------------- Visionneuse -------------------------- */

/**
 * Affiche un PDF SANS la visionneuse native du navigateur, qui porte ses
 * propres boutons Télécharger et Imprimer. Le document reste dans un cadre
 * de l'application, avec le fragment `#toolbar=0` qui masque cette barre
 * là où le navigateur l'honore (Chrome, Edge).
 *
 * Ce n'est pas un verrou : rien n'empêche une capture d'écran, et Firefox
 * ignore le fragment et affiche sa propre barre.
 */
function VisionneusePdf({
  url,
  titre,
  onClose,
}: {
  url: string | null;
  titre: string;
  onClose: () => void;
}) {
  // La touche Échap ferme, comme n'importe quelle boîte de dialogue.
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url, onClose]);

  if (!url) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4 sm:p-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="font-medium text-white">{titre}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={onClose}
          className="bg-white/10 text-white hover:bg-white/20"
        >
          <X className="h-4 w-4 mr-1.5" />
          Fermer
        </Button>
      </div>
      <iframe
        src={`${url}#toolbar=0&navpanes=0&statusbar=0`}
        title={titre}
        className="flex-1 w-full rounded-lg bg-white"
      />
    </div>
  );
}

/**
 * Fabrique une URL de PDF et la confie à la visionneuse, en révoquant la
 * précédente : un blob non révoqué reste en mémoire tout l'onglet durant.
 */
function useVisionneuse() {
  const [url, setUrl] = useState<string | null>(null);
  const [titre, setTitre] = useState("");
  const [chargement, setChargement] = useState<string | null>(null);

  const ouvrir = async (cle: string, libelle: string, fabrique: () => Promise<string>) => {
    setChargement(cle);
    try {
      const u = await fabrique();
      setUrl((ancien) => {
        if (ancien) URL.revokeObjectURL(ancien);
        return u;
      });
      setTitre(libelle);
    } finally {
      setChargement(null);
    }
  };

  const fermer = () => {
    setUrl((ancien) => {
      if (ancien) URL.revokeObjectURL(ancien);
      return null;
    });
  };

  return { url, titre, chargement, ouvrir, fermer };
}

/* --------------------------- Bulletins --------------------------- */

function BulletinsTab({ childId }: { childId: string }) {
  const semestresQuery = useChildBulletinSemestres(childId || null);
  const semestres: any[] = (semestresQuery.data as any[]) ?? [];
  // Un semestre porte déjà son contexte : il sert directement de ligne.
  const { visibles, barre, filtre } = useFiltresScolaires(
    semestres.map((s) => ({ ...s, semestre_id: s.id, semestre_libelle: s.libelle }))
  );
  const visionneuse = useVisionneuse();

  if (semestresQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
      </div>
    );
  }
  if (semestresQuery.isError) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8 text-red-300">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">
            {(semestresQuery.error as Error)?.message ?? "Impossible de charger les bulletins."}
          </p>
        </CardContent>
      </Card>
    );
  }
  if (semestres.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          Aucun bulletin disponible pour le moment.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {barre}
      {visibles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Aucun bulletin pour les filtres sélectionnés.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibles.map((s: any) => (
            <BulletinRow
              key={s.id}
              childId={childId}
              semestre={s}
              visionneuse={visionneuse}
            />
          ))}
        </div>
      )}
      <VisionneusePdf
        url={visionneuse.url}
        titre={visionneuse.titre}
        onClose={visionneuse.fermer}
      />
    </div>
  );
}

function BulletinRow({
  childId,
  semestre,
  visionneuse,
}: {
  childId: string;
  semestre: any;
  visionneuse: ReturnType<typeof useVisionneuse>;
}) {
  const query = useChildBulletin(childId || null, semestre.id);
  const bulletin: any = query.data;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-indigo-500/15 p-2 shrink-0">
            <FileSpreadsheet className="h-6 w-6 text-indigo-400" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-foreground">
              Relevé de notes — {semestreLabelShort(semestre.libelle)}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {/* L'année scolaire situe la période, puis le nom de classe
                  identifie le groupe suivi ; la filière ne sert que de repli. */}
              {bulletin?.annee_academique ?? semestre.annee_scolaire ?? ""}
              {(bulletin?.annee_academique ?? semestre.annee_scolaire) &&
              (semestre.classe_nom ?? semestre.filiere_nom ?? semestre.filiere_code)
                ? " · "
                : ""}
              {semestre.classe_nom ?? semestre.filiere_nom ?? semestre.filiere_code ?? ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {query.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : query.isError ? (
            <span className="text-sm text-red-400">Indisponible</span>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  bulletin &&
                  visionneuse.ouvrir(
                    semestre.id,
                    `Relevé de notes — ${semestreLabelShort(semestre.libelle)}`,
                    () => allBulletinsPdfObjectUrl([bulletin])
                  )
                }
                disabled={!bulletin || visionneuse.chargement === semestre.id}
              >
                {visionneuse.chargement === semestre.id ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4 mr-1.5" />
                )}
                Voir
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ----------------------------- Reçus ----------------------------- */

interface Txn {
  key: string;
  paid_at: string;
  montant: number;
  total_paye: number;
  mode: string;
  reference: string | null;
  receipt_number: string;
  student: { first_name?: string; last_name?: string; matricule?: string | null };
  filiere: { nom?: string | null; code?: string | null };
  ues: { code?: string | null; libelle?: string | null; montant?: number | null }[];
  // Contexte scolaire de la commande réglée : ce qui rend le reçu filtrable.
  annee_scolaire: string | null;
  classe_nom: string | null;
  semestre_id: string | null;
  semestre_libelle: string | null;
}

/** Regroupe les paiements en transactions (même horodatage) + cumul payé. */
function buildTransactions(payments: any[]): { txns: Txn[]; totalDu: number } {
  // Total dû = somme des montants des commandes distinctes.
  const dueByOrder = new Map<string, number>();
  for (const p of payments) {
    if (p.order_reference && !dueByOrder.has(p.order_reference)) {
      dueByOrder.set(p.order_reference, Number(p.order_montant ?? 0));
    }
  }
  const totalDu = Array.from(dueByOrder.values()).reduce((a, b) => a + b, 0);

  const map = new Map<string, any[]>();
  for (const p of payments) {
    const key = String(p.paid_at ?? p.created_at ?? p.id);
    (map.get(key) ?? map.set(key, []).get(key)!).push(p);
  }
  const list: Txn[] = Array.from(map.entries()).map(([key, rows]) => {
    const montant = rows.reduce(
      (a, r) => a + (r.statut === "confirme" || r.statut == null ? Number(r.montant) : 0),
      0
    );
    const nums = rows.map((r) => r.receipt_number).filter(Boolean);
    const receipt_number =
      nums.length <= 1 ? nums[0] ?? "—" : `${nums[0]} (+${nums.length - 1})`;
    const ues = rows.flatMap((r) => (Array.isArray(r.ues) ? r.ues : []));
    const first = rows[0] ?? {};
    return {
      key,
      paid_at: key,
      montant,
      total_paye: 0,
      mode: first.mode,
      reference: rows.find((r) => r.reference_transaction)?.reference_transaction ?? null,
      receipt_number,
      student: {
        first_name: first.first_name,
        last_name: first.last_name,
        matricule: first.matricule,
      },
      filiere: { nom: first.filiere_nom, code: first.filiere_code },
      ues,
      annee_scolaire: first.annee_scolaire ?? null,
      classe_nom: first.classe_nom ?? null,
      semestre_id: first.semestre_id ?? null,
      semestre_libelle: first.semestre_libelle ?? null,
    };
  });
  // Cumul payé, chronologique.
  list.sort((a, b) => new Date(a.paid_at).getTime() - new Date(b.paid_at).getTime());
  let cumul = 0;
  for (const t of list) {
    cumul += t.montant;
    t.total_paye = cumul;
  }
  // Affichage : plus récent en premier.
  list.reverse();
  return { txns: list, totalDu };
}

function toReceiptData(t: Txn, totalDu: number): ReceiptData {
  return {
    receipt_number: t.receipt_number,
    reference_transaction: t.reference,
    montant: t.montant,
    mode: t.mode,
    paid_at: t.paid_at,
    student: t.student,
    filiere: t.filiere,
    total_du: totalDu,
    total_paye: t.total_paye,
    ues: t.ues,
  };
}

function ReceiptsTab({ childId }: { childId: string }) {
  const query = useChildProfessionalPayments(childId || null);
  const payments: any[] = (query.data as any[]) ?? [];
  const { txns, totalDu } = useMemo(() => buildTransactions(payments), [payments]);
  const { visibles, barre } = useFiltresScolaires(txns);
  const visionneuse = useVisionneuse();

  // Les totaux portent sur TOUTE la scolarité, pas sur la sélection : le
  // cumul payé et le reste dû n'ont de sens qu'à l'échelle du dossier.
  const totalPaye = txns.length > 0 ? Math.max(...txns.map((t) => t.total_paye)) : 0;
  const reste = Math.max(0, totalDu - totalPaye);

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8 text-red-300">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">
            {(query.error as Error)?.message ?? "Impossible de charger les reçus."}
          </p>
        </CardContent>
      </Card>
    );
  }
  if (txns.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          Aucun reçu de paiement pour le moment.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={<Wallet className="h-5 w-5 text-emerald-400" />} label="Total payé" value={fmtFCFA(totalPaye)} />
        <StatCard icon={<Receipt className="h-5 w-5 text-sky-400" />} label="Total dû" value={fmtFCFA(totalDu)} />
        <StatCard
          icon={reste <= 0 ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <Wallet className="h-5 w-5 text-amber-400" />}
          label="Reste à payer"
          value={reste <= 0 ? "Soldé" : fmtFCFA(reste)}
        />
      </div>

      {barre}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Date</th>
                  <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">N° reçu</th>
                  <th className="px-3 py-2.5 text-left font-medium">Objet (UE)</th>
                  <th className="px-3 py-2.5 text-left font-medium">Mode</th>
                  <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Montant</th>
                  <th className="px-3 py-2.5 text-center font-medium">Reçu</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((t) => (
                  <tr key={t.key} className="border-b border-border/60 hover:bg-muted/20">
                    <td className="px-4 py-3 whitespace-nowrap text-foreground">{fmtDate(t.paid_at)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {t.receipt_number}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {t.ues.length === 0
                        ? "—"
                        : t.ues.length === 1
                        ? t.ues[0].libelle ?? t.ues[0].code ?? "—"
                        : `${t.ues.length} UE`}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{MODE_LABEL[t.mode] ?? t.mode ?? "—"}</td>
                    <td className="px-3 py-3 text-right font-mono font-semibold text-foreground whitespace-nowrap">
                      {fmtFCFA(t.montant)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            visionneuse.ouvrir(
                              t.key,
                              `Reçu ${t.receipt_number}`,
                              () => receiptPdfObjectUrl(toReceiptData(t, totalDu))
                            )
                          }
                          disabled={visionneuse.chargement === t.key}
                          title="Voir le reçu"
                        >
                          {visionneuse.chargement === t.key ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ExternalLink className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibles.length === 0 && (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Aucun reçu pour les filtres sélectionnés.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <VisionneusePdf
        url={visionneuse.url}
        titre={visionneuse.titre}
        onClose={visionneuse.fermer}
      />
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted/50 shrink-0">{icon}</div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="text-lg font-bold text-foreground truncate">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
