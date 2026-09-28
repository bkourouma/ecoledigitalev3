"use client";

import { useMemo, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { redirect, useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, Button, Badge } from "@ecoledigitale/ui";
import {
  ArrowLeft,
  GraduationCap,
  Mail,
  Calendar,
  Clock,
  Hash,
  BookOpen,
  MessageSquare,
  CalendarCheck,
  Award,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Timer,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import {
  useProfessionalChildren,
  useChildBulletinSemestres,
  useChildBulletin,
  useChildAttendanceHistory,
} from "@/lib/hooks/use-professional-parent";
import {
  fmtNote,
  appreciation,
  ueEtatLabel,
  ueEtatColor,
  decisionLabel,
  semShort,
  semestreLabelShort,
} from "@/lib/bulletin-format";
import { useFiltresScolaires } from "@/components/FiltresScolaires";

/**
 * Détail d'un enfant — espace parent (Module Professionnel, feature 030).
 * Données réelles : identité, aperçu des notes par semestre (de
 * /professionnel/admin/notes) et historique de présence/absence (pointages
 * enseignant /teacher/attendance & admin /professionnel/admin/presences).
 */

const ATT_STATUT: Record<string, { label: string; cls: string; Icon: any }> = {
  present: { label: "Présent", cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300", Icon: CheckCircle2 },
  absent: { label: "Absent", cls: "border-red-500/40 bg-red-500/15 text-red-300", Icon: XCircle },
  retard: { label: "Retard", cls: "border-amber-500/40 bg-amber-500/15 text-amber-300", Icon: Timer },
  excuse: { label: "Excusé", cls: "border-sky-500/40 bg-sky-500/15 text-sky-300", Icon: ShieldCheck },
};

function noteColor(x: number | null | undefined): string {
  if (x == null) return "text-muted-foreground";
  if (x >= 14) return "text-emerald-400";
  if (x >= 12) return "text-sky-400";
  if (x >= 10) return "text-amber-400";
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
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function childName(c: any): string {
  return `${c?.first_name ?? ""} ${c?.last_name ?? ""}`.trim() || "Enfant";
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getGradient(id: string): string {
  const gradients = [
    "from-emerald-500 to-teal-600",
    "from-blue-500 to-indigo-600",
    "from-purple-500 to-pink-600",
    "from-amber-500 to-orange-600",
    "from-rose-500 to-red-600",
    "from-cyan-500 to-blue-600",
  ];
  const sum = Array.from(id).reduce((a, c) => a + c.charCodeAt(0), 0);
  return gradients[sum % gradients.length];
}

export default function ChildDetailPage() {
  const { data: session, status } = useSession();
  const params = useParams();
  const childId = (params?.childId as string) ?? "";

  const childrenQuery = useProfessionalChildren();
  const children: any[] = (childrenQuery.data as any[]) ?? [];
  const child = children.find((c) => c.id === childId);

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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/40 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/parent/children">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -ml-2">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour à la liste
            </Button>
          </Link>

          {child && (
            <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
              <div
                className={`flex-shrink-0 h-20 w-20 rounded-2xl bg-gradient-to-br ${getGradient(child.id)} flex items-center justify-center text-white font-bold text-2xl shadow-lg`}
                aria-hidden="true"
              >
                {getInitials(childName(child))}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-bold text-foreground whitespace-nowrap text-2xl leading-tight md:text-3xl">{childName(child)}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5 font-mono">
                    <Hash className="h-3.5 w-3.5" />
                    {/* Matricule IPAM de la filière, numéro d'établissement à défaut. */}
                    {child.professional_matricule || child.student_number || "—"}
                  </span>
                  {child.email && (
                    <span className="flex items-center gap-1.5 truncate">
                      <Mail className="h-4 w-4" />
                      {child.email}
                    </span>
                  )}
                  {child.date_of_birth && (
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-4 w-4" />
                      Né(e) le {fmtDate(child.date_of_birth)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/parent/children/${childId}/schedule`}>
                  <Button variant="outline" size="sm">
                    <Clock className="h-4 w-4 mr-2" />
                    Emploi du temps
                  </Button>
                </Link>
                <Link href="/parent/homework">
                  <Button variant="outline" size="sm">
                    <BookOpen className="h-4 w-4 mr-2" />
                    Devoirs & notes
                  </Button>
                </Link>
                <Link href="/parent/messages">
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white">
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Contacter
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {childrenQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
          </div>
        ) : childrenQuery.isError ? (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="pt-6 text-center py-8">
              <p className="text-red-400 font-medium">Erreur lors du chargement</p>
              <p className="text-muted-foreground text-sm mt-2">
                {(childrenQuery.error as Error)?.message ?? "Impossible de charger l'enfant."}
              </p>
            </CardContent>
          </Card>
        ) : !child ? (
          <Card>
            <CardContent className="pt-6 text-center py-8">
              <p className="text-muted-foreground">
                Enfant non trouvé ou non rattaché à votre compte.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            <AttendanceSection childId={childId} />
            <NotesSection childId={childId} />
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------- Présences --------------------------- */

function AttendanceSection({ childId }: { childId: string }) {
  const query = useChildAttendanceHistory(childId || null);
  const toutes: any[] = (query.data as any[]) ?? [];
  // Chaque séance porte le contexte de sa cohorte : année, nom de classe et
  // semestre. Statistiques ET historique portent sur la sélection.
  const { visibles: records, barre } = useFiltresScolaires(toutes);

  const stats = useMemo(() => {
    let present = 0, absent = 0, retard = 0, excuse = 0, pointes = 0;
    for (const r of records) {
      if (r.statut === "present") present += 1;
      else if (r.statut === "absent") absent += 1;
      else if (r.statut === "retard") retard += 1;
      else if (r.statut === "excuse") excuse += 1;
      if (r.statut) pointes += 1;
    }
    const taux = pointes > 0 ? Math.round(((present + retard) / pointes) * 100) : null;
    return { present, absent, retard, excuse, pointes, taux, total: records.length };
  }, [records]);

  // N'affiche que les séances effectivement pointées dans l'historique.
  const pointed = records.filter((r) => !!r.statut);

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <CalendarCheck className="h-5 w-5 text-emerald-400" />
        <h2 className="text-xl font-bold text-foreground">Présences & absences</h2>
      </div>

      {toutes.length > 0 && <div className="mb-4">{barre}</div>}

      {query.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
        </div>
      ) : query.isError ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-red-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p className="text-sm">
              {(query.error as Error)?.message ?? "Impossible de charger les présences."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <AttStat icon={<CheckCircle2 className="h-5 w-5 text-emerald-400" />} label="Présences" value={stats.present} />
            <AttStat icon={<XCircle className="h-5 w-5 text-red-400" />} label="Absences" value={stats.absent} />
            <AttStat icon={<Timer className="h-5 w-5 text-amber-400" />} label="Retards" value={stats.retard} />
            <AttStat icon={<ShieldCheck className="h-5 w-5 text-sky-400" />} label="Excusés" value={stats.excuse} />
          </div>

          {stats.taux != null && (
            <p className="text-sm text-muted-foreground">
              Taux de présence :{" "}
              <span className="font-semibold text-foreground">{stats.taux}%</span> sur{" "}
              {stats.pointes} séance{stats.pointes > 1 ? "s" : ""} pointée
              {stats.pointes > 1 ? "s" : ""}.
            </p>
          )}

          {pointed.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                {toutes.length === 0
                  ? "Aucun pointage de présence pour le moment."
                  : records.length === 0
                    ? "Aucune séance pour les filtres sélectionnés."
                    : "Aucun pointage de présence sur cette sélection."}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Date</th>
                        <th className="px-3 py-2.5 text-left font-medium">Matière (ECUE)</th>
                        <th className="px-3 py-2.5 text-left font-medium">Unité (UE)</th>
                        <th className="px-3 py-2.5 text-center font-medium">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pointed.map((r) => {
                        const st = ATT_STATUT[r.statut] ?? null;
                        return (
                          <tr key={r.seance_id} className="border-b border-border/60 hover:bg-muted/20">
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="text-foreground">{fmtDate(r.date)}</div>
                              {(r.heure_debut || r.heure_fin) && (
                                <div className="text-xs text-muted-foreground">
                                  {(r.heure_debut ?? "").slice(0, 5)}
                                  {r.heure_fin ? ` – ${String(r.heure_fin).slice(0, 5)}` : ""}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-3 text-foreground">
                              {r.ecue_libelle ?? r.ecue_code ?? "—"}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {r.ue_libelle ?? r.ue_code ?? "—"}
                            </td>
                            <td className="px-3 py-3 text-center">
                              {st ? (
                                <Badge variant="outline" className={st.cls}>
                                  <st.Icon className="h-3 w-3 mr-1" />
                                  {st.label}
                                </Badge>
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
          )}
        </div>
      )}
    </section>
  );
}

function AttStat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted/50 shrink-0">{icon}</div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
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
  // Tri chronologique : l'année d'abord, puis le rang du semestre. Trier sur le
  // seul rang mettrait côte à côte le Semestre 1 de deux années différentes.
  const sorted = useMemo(
    () =>
      [...visibles].sort(
        (a: any, b: any) =>
          String(a.annee_scolaire ?? "").localeCompare(String(b.annee_scolaire ?? "")) ||
          semNum(a.libelle) - semNum(b.libelle)
      ),
    [visibles]
  );

  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5 text-emerald-400" />
          <h2 className="text-xl font-bold text-foreground">Historique des notes</h2>
        </div>
        <Link href="/parent/homework">
          <Button variant="outline" size="sm">
            <BookOpen className="h-4 w-4 mr-2" />
            Détail des devoirs
          </Button>
        </Link>
      </div>

      {semestres.length > 0 && <div className="mb-4">{barre}</div>}

      {semestresQuery.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
        </div>
      ) : semestresQuery.isError ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-red-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p className="text-sm">
              {(semestresQuery.error as Error)?.message ?? "Impossible de charger les notes."}
            </p>
          </CardContent>
        </Card>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {semestres.length === 0
              ? "Aucune note disponible : l'enfant n'est inscrit à aucun semestre pour l'instant."
              : "Aucun semestre pour les filtres sélectionnés."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {sorted.map((s) => (
            <SemesterOverview key={s.id} childId={childId} semestre={s} />
          ))}
        </div>
      )}
    </section>
  );
}

function SemesterOverview({ childId, semestre }: { childId: string; semestre: any }) {
  const query = useChildBulletin(childId || null, semestre.id);
  const bulletin: any = query.data;
  const ues: any[] = bulletin?.ues ?? [];
  const sem = semShort(semestre.libelle);

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
              Moyenne {fmtNote(bulletin.moyenne_session)} · {appreciation(bulletin.moyenne_session)}
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
                  <th className="px-4 py-2.5 text-left font-medium">Unité d'enseignement</th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">Moyenne /20</th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">Crédits</th>
                  <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">Statut</th>
                </tr>
              </thead>
              <tbody>
                {ues.map((ue) => (
                  <tr key={ue.ue_session_id ?? ue.ue_id} className="border-b border-border/60 hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-foreground">{ue.libelle ?? ue.code ?? "—"}</td>
                    <td className={`px-3 py-2.5 text-center font-mono font-semibold ${noteColor(ue.moyenne_ue)}`}>
                      {fmtNote(ue.moyenne_ue)}
                    </td>
                    <td className="px-3 py-2.5 text-center text-muted-foreground">{ue.credits ?? "—"}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-xs font-semibold" style={{ color: ueEtatColor(ue.etat) }}>
                        {ueEtatLabel(ue.etat)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
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
