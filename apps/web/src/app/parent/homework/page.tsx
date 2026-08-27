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
  Users,
  ClipboardList,
  Award,
  BookOpen,
  Brain,
  FileText,
  CalendarRange,
  GraduationCap,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Hourglass,
  TrendingUp,
  Star,
} from "lucide-react";
import {
  useProfessionalChildren,
  useChildAssignments,
  useChildBulletinSemestres,
  useChildBulletin,
  useChildBulletinNotes,
} from "@/lib/hooks/use-professional-parent";
import {
  fmtNote,
  appreciation,
  ueEtatLabel,
  ueEtatColor,
  sessionLabel,
  decisionLabel,
  semShort,
  semestreLabelShort,
} from "@/lib/bulletin-format";
import { useFiltresScolaires } from "@/components/FiltresScolaires";

/**
 * Devoirs & Notes — espace parent (Module Professionnel, feature 030).
 *
 * Affiche les informations réelles de l'enfant, issues des pages enseignant :
 *  - Devoirs & évaluations créés dans /teacher/courses (onglet Évaluations) ;
 *  - Notes saisies dans /professionnel/admin/notes (UE → ECUE : Devoirs / Examen
 *    / Note), regroupées par semestre.
 * Lecture seule, scopée aux enfants rattachés au parent connecté.
 */

const EVAL_TYPE_LABEL: Record<string, string> = {
  online: "En ligne",
  pdf: "Sujet PDF",
  ai_generated: "IA",
};

const ECUE_STATUT: Record<string, { label: string; cls: string }> = {
  valide: { label: "Validé", cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" },
  compense: { label: "Compensé", cls: "border-sky-500/40 bg-sky-500/15 text-sky-300" },
  insuffisant: { label: "Insuffisant", cls: "border-amber-500/40 bg-amber-500/15 text-amber-300" },
  eliminatoire: { label: "Éliminatoire", cls: "border-red-500/40 bg-red-500/15 text-red-300" },
  en_cours: { label: "En attente", cls: "border-slate-500/40 bg-slate-500/15 text-slate-300" },
};

function noteColor(x: number | null | undefined): string {
  if (x == null) return "text-muted-foreground";
  if (x >= 16) return "text-emerald-400";
  if (x >= 14) return "text-emerald-300";
  if (x >= 12) return "text-sky-400";
  if (x >= 10) return "text-amber-400";
  if (x >= 8) return "text-amber-500/90";
  return "text-red-400";
}

function semNum(libelle: string | null | undefined): number {
  const m = String(libelle ?? "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 99;
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime())
    ? String(value)
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function childName(c: any): string {
  return `${c?.first_name ?? ""} ${c?.last_name ?? ""}`.trim() || "Enfant";
}

export default function ParentHomeworkPage() {
  const { data: session, status } = useSession();
  const childrenQuery = useProfessionalChildren();
  const children: any[] = (childrenQuery.data as any[]) ?? [];
  const [childId, setChildId] = useState<string>("");
  const [tab, setTab] = useState<"devoirs" | "notes">("devoirs");

  // Sélectionne le premier enfant par défaut.
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
    <div className="space-y-8 max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-500 to-blue-500 bg-clip-text text-transparent flex items-center gap-3">
            <ClipboardList className="h-8 w-8 text-emerald-400 shrink-0" />
            Devoirs & Notes
          </h1>
          <p className="text-muted-foreground mt-2">
            Les devoirs, évaluations et notes réels de votre enfant, saisis par
            ses enseignants.
          </p>
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

      {childrenQuery.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          <span className="ml-2 text-lg text-muted-foreground">Chargement…</span>
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
          {selectedChild && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <GraduationCap className="h-4 w-4 text-emerald-400" />
              Suivi de{" "}
              <span className="font-semibold text-foreground">{childName(selectedChild)}</span>
              {selectedChild.student_number && (
                <span className="font-mono text-xs">· {selectedChild.student_number}</span>
              )}
            </div>
          )}

          {/* Onglets */}
          <div className="border-b border-border">
            <nav className="flex gap-2">
              <TabButton active={tab === "devoirs"} onClick={() => setTab("devoirs")}>
                <ClipboardList className="h-4 w-4" />
                Devoirs & évaluations
              </TabButton>
              <TabButton active={tab === "notes"} onClick={() => setTab("notes")}>
                <Award className="h-4 w-4" />
                Notes
              </TabButton>
            </nav>
          </div>

          {tab === "devoirs" ? (
            <AssignmentsSection childId={childId} />
          ) : (
            <NotesSection childId={childId} />
          )}
        </>
      )}
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

/* ----------------------------- Devoirs ----------------------------- */

function EvalTypeBadge({ type }: { type: string }) {
  const cls =
    type === "online"
      ? "border-green-500/40 bg-green-500/15 text-green-400"
      : type === "ai_generated"
      ? "border-purple-500/40 bg-purple-500/15 text-purple-400"
      : "border-blue-500/40 bg-blue-500/15 text-blue-400";
  const Icon = type === "online" ? BookOpen : type === "ai_generated" ? Brain : FileText;
  return (
    <Badge variant="outline" className={cls}>
      <Icon className="h-3 w-3 mr-1" />
      {EVAL_TYPE_LABEL[type] ?? "—"}
    </Badge>
  );
}

/** Statut de la copie de l'enfant pour un devoir. */
function SubmissionBadge({ a }: { a: any }) {
  const st = a.submission_statut as string | null;
  if (st === "note") {
    return (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Corrigé
      </Badge>
    );
  }
  if (st === "soumis" || st === "en_correction") {
    return (
      <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-300">
        <Hourglass className="h-3 w-3 mr-1" />
        {st === "en_correction" ? "En correction" : "Soumis"}
      </Badge>
    );
  }
  // Pas de soumission : à rendre (échéance dépassée = en retard).
  const late = a.due_at && new Date(a.due_at).getTime() < Date.now();
  return (
    <Badge
      variant="outline"
      className={
        late
          ? "border-red-500/40 bg-red-500/15 text-red-300"
          : "border-slate-500/40 bg-slate-500/15 text-slate-300"
      }
    >
      <Clock className="h-3 w-3 mr-1" />
      {late ? "Non rendu" : "À faire"}
    </Badge>
  );
}

function AssignmentsSection({ childId }: { childId: string }) {
  const query = useChildAssignments(childId || null);
  const toutes: any[] = (query.data as any[]) ?? [];
  // Chaque devoir porte le contexte de la cohorte où il a été donné : année,
  // nom de classe et semestre. Les compteurs suivent la sélection.
  const { visibles: items, barre } = useFiltresScolaires(toutes);

  const stats = useMemo(() => {
    let notes = 0;
    let attente = 0;
    for (const a of items) {
      if (a.submission_statut === "note") notes += 1;
      else attente += 1;
    }
    return { total: items.length, notes, attente };
  }, [items]);

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
            {(query.error as Error)?.message ?? "Impossible de charger les devoirs."}
          </p>
        </CardContent>
      </Card>
    );
  }
  if (toutes.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          Aucun devoir ni évaluation pour le moment.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {barre}

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Aucun devoir pour les filtres sélectionnés.
          </CardContent>
        </Card>
      ) : (
        <>
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={<ClipboardList className="h-5 w-5 text-emerald-400" />} label="Total" value={stats.total} />
        <StatCard icon={<CheckCircle2 className="h-5 w-5 text-sky-400" />} label="Corrigés" value={stats.notes} />
        <StatCard icon={<Hourglass className="h-5 w-5 text-amber-400" />} label="En attente" value={stats.attente} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Devoir / Évaluation</th>
                  <th className="px-3 py-2.5 text-left font-medium">Matière (ECUE)</th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">Échéance</th>
                  <th className="px-3 py-2.5 text-center font-medium">Statut</th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">Note</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const noteVal = a.submission_statut === "note" ? Number(a.note) : null;
                  return (
                    <tr key={a.id} className="border-b border-border/60 hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{a.titre}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {a.type === "examen" ? (
                            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-300">
                              Examen
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-300">
                              Devoir
                            </Badge>
                          )}
                          <EvalTypeBadge type={a.evaluation_type} />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {a.ecue_libelle ?? a.ecue_code ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-center text-muted-foreground whitespace-nowrap">
                        {fmtDate(a.due_at)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <SubmissionBadge a={a} />
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {noteVal != null && !Number.isNaN(noteVal) ? (
                          <span className={`font-mono font-semibold ${noteColor(noteVal)}`}>
                            {fmtNote(noteVal)}
                            <span className="text-muted-foreground font-normal">
                              /{a.note_max ?? 20}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
        </>
      )}
    </div>
  );
}

/* ----------------------------- Notes ----------------------------- */

function NotesSection({ childId }: { childId: string }) {
  const semestresQuery = useChildBulletinSemestres(childId || null);
  const semestres: any[] = (semestresQuery.data as any[]) ?? [];
  // Un semestre porte déjà son contexte : il sert directement de ligne aux
  // filtres année scolaire → nom de classe → semestre.
  const { visibles, barre } = useFiltresScolaires(
    semestres.map((s) => ({ ...s, semestre_id: s.id, semestre_libelle: s.libelle }))
  );

  const sorted = useMemo(
    () => [...visibles].sort((a, b) => semNum(a.libelle) - semNum(b.libelle)),
    [visibles]
  );

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
            {(semestresQuery.error as Error)?.message ?? "Impossible de charger les notes."}
          </p>
        </CardContent>
      </Card>
    );
  }
  if (semestres.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          Aucune note disponible : votre enfant n'est inscrit à aucun semestre pour l'instant.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {barre}

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Aucun semestre pour les filtres sélectionnés.
          </CardContent>
        </Card>
      ) : (
        sorted.map((s) => <SemesterNotes key={s.id} childId={childId} semestre={s} />)
      )}
      <p className="text-xs text-muted-foreground">
        Chaque matière (ECUE) : <span className="font-medium">Devoirs</span> (une
        pastille par devoir) · <span className="font-medium">Examen</span> ·{" "}
        <span className="font-medium">Note</span> = moyenne des devoirs × 0,4 +
        examen × 0,6. La couleur de la Note indique le statut.
      </p>
    </div>
  );
}

function SemesterNotes({ childId, semestre }: { childId: string; semestre: any }) {
  const query = useChildBulletin(childId || null, semestre.id);
  const notesQuery = useChildBulletinNotes(childId || null, semestre.id);
  const bulletin: any = query.data;
  const ues: any[] = bulletin?.ues ?? [];
  const sem = semShort(semestre.libelle);

  const devoirsByEcue = useMemo(() => {
    const m = new Map<string, any[]>();
    const push = (ueSessionId: string, ecueId: string, d: any) => {
      const k = `${ueSessionId}::${ecueId}`;
      const list = m.get(k) ?? [];
      list.push(d);
      m.set(k, list);
    };
    const data: any = notesQuery.data;
    for (const n of data?.notes ?? []) {
      if (n.nature !== "devoir") continue;
      push(n.ue_session_id, n.ecue_id, { note: n.note, kind: "manuel", label: n.libelle });
    }
    for (const s of data?.submissions ?? []) {
      if (s.type === "examen") continue;
      push(s.ue_session_id, s.ecue_id, { note: s.note, kind: "eval", label: s.titre });
    }
    return m;
  }, [notesQuery.data]);

  return (
    <Card className="overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-emerald-500/10 to-blue-500/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg bg-emerald-500/20 px-2 text-sm font-bold text-emerald-300">
            {sem}
          </span>
          <div>
            <p className="font-semibold text-foreground leading-tight">
              {semestreLabelShort(semestre.libelle)}
            </p>
            <p className="text-xs text-muted-foreground">
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
        {bulletin && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-200">
              <TrendingUp className="h-3.5 w-3.5 mr-1" />
              Moyenne {fmtNote(bulletin.moyenne_session)}
            </Badge>
            <Badge variant="outline" className="border-sky-500/40 bg-sky-500/15 text-sky-200">
              {bulletin.credits_valides ?? 0}/{bulletin.credits_total ?? 0} crédits
            </Badge>
            <DecisionBadge decision={bulletin.decision} />
          </div>
        )}
      </div>

      <CardContent className="p-0">
        {query.isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
          </div>
        ) : query.isError ? (
          <div className="flex items-center gap-3 px-4 py-8 text-red-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p className="text-sm">{(query.error as Error)?.message ?? "Erreur."}</p>
          </div>
        ) : ues.length === 0 ? (
          <div className="px-4 py-10 text-center text-muted-foreground text-sm">
            Aucune note disponible pour ce semestre pour l'instant.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Unité d'enseignement / Matière</th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">Devoirs</th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">Examen</th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">Note /20</th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">Crédits</th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">Statut</th>
                </tr>
              </thead>
              <tbody>
                {ues.map((ue) => (
                  <UeRows key={ue.ue_session_id ?? ue.ue_id} ue={ue} devoirsByEcue={devoirsByEcue} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {bulletin && ues.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border bg-muted/20 px-4 py-3 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              UE validées :{" "}
              <span className="font-semibold text-foreground">
                {bulletin.nb_ue_validees ?? 0}/{bulletin.nb_ue_total ?? 0}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Star className="h-4 w-4 text-amber-400" />
              Moyenne :{" "}
              <span className={`font-semibold ${noteColor(bulletin.moyenne_session)}`}>
                {fmtNote(bulletin.moyenne_session)}
              </span>
              <span className="text-muted-foreground">· {appreciation(bulletin.moyenne_session)}</span>
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarRange className="h-4 w-4 text-sky-400" />
              {sessionLabel(bulletin.session_globale ?? 1)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NotePill({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center rounded-full bg-slate-500/15 px-2.5 py-1 text-[13px] font-mono text-slate-200">
      {fmtNote(value)}
    </span>
  );
}

function DevoirsCell({ devoirs, moyenne }: { devoirs: any[]; moyenne: number | null | undefined }) {
  if (devoirs.length === 0) return <NotePill value={moyenne} />;
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {devoirs.map((d, i) => (
        <span
          key={i}
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[13px] font-mono ${
            d.kind === "eval" ? "bg-sky-500/15 text-sky-200" : "bg-slate-500/15 text-slate-200"
          }`}
          title={d.label ?? (d.kind === "eval" ? "Évaluation" : "Devoir")}
        >
          {fmtNote(d.note)}
        </span>
      ))}
    </div>
  );
}

function UeRows({ ue, devoirsByEcue }: { ue: any; devoirsByEcue: Map<string, any[]> }) {
  const ecues: any[] = ue?.ecues ?? [];
  return (
    <>
      <tr className="border-b border-border bg-muted/20 font-semibold">
        <td className="px-4 py-2.5 uppercase text-foreground">{ue.libelle ?? ue.code ?? "—"}</td>
        <td className="px-3 py-2.5 text-center text-muted-foreground">—</td>
        <td className="px-3 py-2.5 text-center text-muted-foreground">—</td>
        <td className={`px-3 py-2.5 text-center font-bold ${noteColor(ue.moyenne_ue)}`}>
          {fmtNote(ue.moyenne_ue)}
        </td>
        <td className="px-3 py-2.5 text-center text-foreground">{ue.credits ?? "—"}</td>
        <td className="px-3 py-2.5 text-center">
          <span className="text-xs font-semibold" style={{ color: ueEtatColor(ue.etat) }}>
            {ueEtatLabel(ue.etat)}
          </span>
        </td>
      </tr>
      {ecues.map((e) => {
        const st = ECUE_STATUT[e.statut] ?? ECUE_STATUT.en_cours;
        const devoirs = devoirsByEcue.get(`${ue.ue_session_id}::${e.ecue_id}`) ?? [];
        return (
          <tr key={e.ecue_id} className="border-b border-border/60 hover:bg-muted/20">
            <td className="px-4 py-2 pl-8 text-muted-foreground">{e.libelle ?? e.code ?? "—"}</td>
            <td className="px-3 py-2 text-center">
              <DevoirsCell devoirs={devoirs} moyenne={e.moyenne_devoirs} />
            </td>
            <td className="px-3 py-2 text-center">
              <NotePill value={e.note_examen} />
            </td>
            <td className="px-3 py-2 text-center">
              <span
                className={`inline-block rounded px-2.5 py-1 text-sm font-mono font-semibold border ${st.cls}`}
                title={st.label}
              >
                {fmtNote(e.note_ecue)}
              </span>
            </td>
            <td className="px-3 py-2 text-center text-muted-foreground">{e.credits ?? "—"}</td>
            <td className="px-3 py-2 text-center">
              <Badge variant="outline" className={st.cls}>
                {st.label}
              </Badge>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function DecisionBadge({ decision }: { decision: string | null | undefined }) {
  const cls =
    decision === "admis"
      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
      : decision === "rattrapage"
      ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
      : "border-red-500/40 bg-red-500/15 text-red-300";
  return (
    <Badge variant="outline" className={cls}>
      {decisionLabel(decision)}
    </Badge>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted/50 shrink-0">{icon}</div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="text-xl font-bold text-foreground">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
