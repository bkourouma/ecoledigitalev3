"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card, CardContent } from "@ecoledigitale/ui";
import {
  Layers,
  GraduationCap,
  BookOpen,
  Users,
  User,
  UserPlus,
  Wallet,
  Calendar,
  CalendarRange,
  CalendarClock,
  DoorOpen,
  ClipboardCheck,
  ClipboardList,
  Star,
  FileSpreadsheet,
  Award,
  PenLine,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { useStudents } from "@/lib/hooks/use-students";
import { useAllTeachers } from "@/lib/hooks/use-teachers";
import { useParents } from "@/lib/hooks/use-parents";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import { useCycles } from "@/lib/hooks/use-cycles";
import {
  useAllProfessionalUeList,
  useAllProfessionalEcueList,
  useProfessionalUeSessionsList,
} from "@/lib/hooks/use-professional-catalog-admin";
import { useAllAdminEnrollments } from "@/lib/hooks/use-professional-suivi";

/**
 * Tableau de bord administrateur.
 *
 * Deux niveaux de lecture :
 *  1. des indicateurs CALCULÉS sur les données réelles (aucune valeur en dur) ;
 *  2. l'accès à tous les écrans, regroupés exactement comme dans le menu latéral
 *     pour que l'utilisateur retrouve la même carte mentale des deux côtés.
 */

/* --------------------------------- Outils --------------------------------- */

const nf = new Intl.NumberFormat("fr-FR");

function fmtMontant(v: number): string {
  return `${nf.format(Math.round(v))} FCFA`;
}

/** Une cohorte reste active tant qu'elle n'est ni terminée ni annulée. */
function isCohorteActive(statut: unknown): boolean {
  return !["termine", "annule"].includes(String(statut ?? ""));
}

/* ------------------------------- Composants ------------------------------- */

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  gradient,
  href,
  loading,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: any;
  gradient: string;
  href?: string;
  loading?: boolean;
}) {
  const inner = (
    <div
      className={`relative flex h-full flex-col overflow-hidden rounded-xl bg-gradient-to-br ${gradient} p-5 text-white shadow-lg transition-all duration-300 ${
        href ? "hover:shadow-xl hover:-translate-y-0.5" : ""
      }`}
    >
      {/* Le libellé occupe une hauteur fixe de deux lignes : sans cela, un
          intitulé qui passe à la ligne (« Unités d'enseignement ») décale son
          chiffre vers le bas et les cartes d'une même rangée se désalignent. */}
      <div className="relative z-10 flex items-start justify-between gap-3">
        <p className="min-h-[2.5rem] text-sm font-medium leading-tight text-white/85">{label}</p>
        <div className="shrink-0 rounded-lg bg-white/20 p-2.5">
          <Icon className="h-5 w-5" />
        </div>
      </div>

      <p className="relative z-10 mt-1 text-3xl font-bold leading-none tabular-nums">
        {loading ? <Loader2 className="h-8 w-8 animate-spin" /> : value}
      </p>

      {/* `mt-auto` cale l'indication en bas : toutes les cartes de la rangée ont
          la même hauteur, la ligne d'aide est donc alignée elle aussi. */}
      {hint && <p className="relative z-10 mt-auto pt-2 text-xs leading-snug text-white/70">{hint}</p>}

      {/* Décor de fond, cohérent avec les cartes du reste de l'application. */}
      <div className="pointer-events-none absolute top-0 right-0 h-28 w-28 translate-x-14 -translate-y-14 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-20 w-20 -translate-x-10 translate-y-10 rounded-full bg-white/5" />
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
}

type MenuEntry = { label: string; href: string; icon: any; count?: number | null };

function MenuGroup({
  title,
  accent,
  entries,
}: {
  title: string;
  accent: string;
  entries: MenuEntry[];
}) {
  return (
    <Card className="shadow-sm h-full">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className={`h-6 w-1.5 rounded-full ${accent}`} />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </h3>
        </div>
        <div className="space-y-1">
          {entries.map((e) => {
            const Icon = e.icon;
            return (
              <Link
                key={e.href}
                href={e.href}
                className="group flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted"
              >
                <span className="rounded-md bg-muted p-1.5 text-muted-foreground transition-colors group-hover:bg-background">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex-1 text-sm font-medium">{e.label}</span>
                {e.count != null && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                    {nf.format(e.count)}
                  </span>
                )}
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------- Page ----------------------------------- */

export default function TableauDeBordPage() {
  // Une seule ligne suffit pour lire le total renvoyé par la pagination.
  const studentsQuery = useStudents({ page: 1, limit: 1 });
  const parentsQuery = useParents({ page: 1, limit: 1 });
  const teachersQuery = useAllTeachers();
  const programmesQuery = useProgrammes();
  const cyclesQuery = useCycles();
  const ueQuery = useAllProfessionalUeList();
  const ecueQuery = useAllProfessionalEcueList();
  const sessionsQuery = useProfessionalUeSessionsList({ pageSize: 500 } as any);
  const enrollmentsQuery = useAllAdminEnrollments();

  const nbStudents = studentsQuery.data?.pagination?.total ?? 0;
  const nbParents = (parentsQuery.data as any)?.data?.total ?? 0;
  const nbTeachers = ((teachersQuery.data as any)?.data ?? []).length;
  const nbProgrammes = ((programmesQuery.data as any)?.data ?? []).length;
  const nbCycles = ((cyclesQuery.data as any)?.data ?? []).length;
  const nbUe = (ueQuery.data as any)?.total ?? 0;
  const nbEcue = (ecueQuery.data as any)?.total ?? 0;

  const sessions: any[] = (sessionsQuery.data as any)?.items ?? [];
  const sessionsActives = useMemo(
    () => sessions.filter((s) => isCohorteActive(s.statut)).length,
    [sessions]
  );

  const enrollments: any[] = (enrollmentsQuery.data as any)?.items ?? [];

  /**
   * Indicateurs financiers du module professionnel.
   *
   * Piège traité : `montant_paye` est porté par la COMMANDE, pas par
   * l'inscription. Sommer la colonne sur les inscriptions compterait plusieurs
   * fois le même règlement dès qu'une commande couvre plusieurs UE — d'où la
   * déduplication par `order_id`.
   */
  const finances = useMemo(() => {
    const actives = enrollments.filter((e) => e.statut !== "annulee");
    const du = actives.reduce((sum, e) => sum + (Number(e.prix_unitaire) || 0), 0);
    const parCommande = new Map<string, number>();
    for (const e of actives) {
      if (e.order_id && !parCommande.has(e.order_id)) {
        parCommande.set(e.order_id, Number(e.montant_paye) || 0);
      }
    }
    const paye = Array.from(parCommande.values()).reduce((a, b) => a + b, 0);
    const taux = du > 0 ? Math.round((paye / du) * 100) : 0;
    return { du, paye, reste: Math.max(0, du - paye), taux, nbActives: actives.length };
  }, [enrollments]);

  /** Étudiants distincts ayant au moins une inscription non annulée. */
  const nbInscrits = useMemo(
    () => new Set(enrollments.filter((e) => e.statut !== "annulee").map((e) => e.student_id)).size,
    [enrollments]
  );

  const enAttentePaiement = useMemo(
    () => enrollments.filter((e) => e.statut === "en_attente_paiement").length,
    [enrollments]
  );

  const chargement =
    studentsQuery.isLoading ||
    teachersQuery.isLoading ||
    parentsQuery.isLoading ||
    enrollmentsQuery.isLoading;

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      {/* En-tête */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 p-8 text-white shadow-xl">
        <div className="relative z-10">
          <p className="text-sm font-medium text-white/80">Espace administrateur</p>
          <h1 className="mt-1 text-4xl font-bold">Tableau de bord</h1>
          <p className="mt-3 max-w-2xl text-white/85">
            Vue consolidée de l&apos;établissement : structure académique, module professionnel,
            suivi pédagogique et documents officiels.
          </p>
        </div>
        <div className="absolute top-0 right-0 h-64 w-64 translate-x-24 -translate-y-24 rounded-full bg-white/10" />
        <div className="absolute bottom-0 right-24 h-40 w-40 translate-y-20 rounded-full bg-white/5" />
      </div>

      {/* Indicateurs — personnes */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Personnes</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Étudiants"
            value={nf.format(nbStudents)}
            hint={`${nf.format(nbInscrits)} inscrits au module pro`}
            icon={GraduationCap}
            gradient="from-teal-500 via-cyan-500 to-blue-500"
            href="/academic/students"
            loading={studentsQuery.isLoading}
          />
          <StatCard
            label="Enseignants"
            value={nf.format(nbTeachers)}
            icon={Users}
            gradient="from-orange-500 via-amber-500 to-yellow-500"
            href="/academic/teachers"
            loading={teachersQuery.isLoading}
          />
          <StatCard
            label="Parents"
            value={nf.format(nbParents)}
            icon={User}
            gradient="from-rose-500 via-pink-500 to-fuchsia-500"
            href="/academic/parents"
            loading={parentsQuery.isLoading}
          />
          <StatCard
            label="Filières"
            value={nf.format(nbProgrammes)}
            hint={`${nf.format(nbCycles)} cycle${nbCycles > 1 ? "s" : ""}`}
            icon={Layers}
            gradient="from-violet-500 via-purple-500 to-indigo-500"
            href="/academic/programmes"
            loading={programmesQuery.isLoading}
          />
        </div>
      </section>

      {/* Indicateurs — module professionnel */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Module professionnel</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Unités d'enseignement"
            value={nf.format(nbUe)}
            hint={`${nf.format(nbEcue)} ECUE`}
            icon={BookOpen}
            gradient="from-indigo-500 via-blue-500 to-sky-500"
            href="/professionnel/admin/ue"
            loading={ueQuery.isLoading}
          />
          <StatCard
            label="Cohortes ouvertes"
            value={nf.format(sessionsActives)}
            hint={`sur ${nf.format(sessions.length)} au total`}
            icon={Calendar}
            gradient="from-emerald-500 via-teal-500 to-cyan-500"
            href="/professionnel/admin/sessions"
            loading={sessionsQuery.isLoading}
          />
          <StatCard
            label="Inscriptions actives"
            value={nf.format(finances.nbActives)}
            hint={`${nf.format(enAttentePaiement)} en attente de paiement`}
            icon={UserPlus}
            gradient="from-blue-500 via-indigo-500 to-purple-500"
            href="/professionnel/admin/inscrits"
            loading={enrollmentsQuery.isLoading}
          />
          <StatCard
            label="Taux de recouvrement"
            value={`${finances.taux} %`}
            hint={`${fmtMontant(finances.paye)} encaissés`}
            icon={Wallet}
            gradient="from-amber-500 via-orange-500 to-red-500"
            href="/professionnel/admin/paiements"
            loading={enrollmentsQuery.isLoading}
          />
        </div>

        {/* Détail du recouvrement */}
        {!enrollmentsQuery.isLoading && finances.du > 0 && (
          <Card className="shadow-sm">
            <CardContent className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {finances.taux >= 80 ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                  )}
                  <span className="font-medium">Recouvrement des inscriptions</span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {fmtMontant(finances.paye)} encaissés sur {fmtMontant(finances.du)} dus
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-green-500 transition-all"
                  style={{ width: `${Math.min(100, finances.taux)}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Reste à recouvrer :{" "}
                <span className="font-semibold text-foreground">{fmtMontant(finances.reste)}</span>
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Accès aux écrans — même découpage que le menu latéral */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-indigo-500" />
          <h2 className="text-lg font-semibold">Structure académique</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <MenuGroup
            title="Cycles & Programmes"
            accent="bg-violet-500"
            entries={[
              { label: "Cycles", href: "/academic/cycles", icon: GraduationCap, count: nbCycles },
              { label: "Filières", href: "/academic/programmes", icon: BookOpen, count: nbProgrammes },
            ]}
          />
          <MenuGroup
            title="Personnes"
            accent="bg-teal-500"
            entries={[
              { label: "Enseignants", href: "/academic/teachers", icon: Users, count: nbTeachers },
              { label: "Étudiants", href: "/academic/students", icon: GraduationCap, count: nbStudents },
              { label: "Parents", href: "/academic/parents", icon: User, count: nbParents },
            ]}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-indigo-500" />
          <h2 className="text-lg font-semibold">Module professionnel</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <MenuGroup
            title="Programme"
            accent="bg-indigo-500"
            entries={[
              { label: "UE", href: "/professionnel/admin/ue", icon: Layers, count: nbUe },
              { label: "ECUE", href: "/professionnel/admin/matieres", icon: BookOpen, count: nbEcue },
              {
                label: "Semestres",
                href: "/professionnel/admin/semestres",
                icon: CalendarRange,
              },
            ]}
          />
          <MenuGroup
            title="Sessions & Planning"
            accent="bg-emerald-500"
            entries={[
              {
                label: "Sessions",
                href: "/professionnel/admin/sessions",
                icon: Calendar,
                count: sessions.length,
              },
              { label: "Salles de classe", href: "/academic/classrooms", icon: DoorOpen },
              {
                label: "Planning des cours",
                href: "/professionnel/admin/planning",
                icon: CalendarClock,
              },
            ]}
          />
          <MenuGroup
            title="Étudiants"
            accent="bg-blue-500"
            entries={[
              {
                label: "Inscriptions",
                href: "/professionnel/admin/inscriptions",
                icon: UserPlus,
              },
              {
                label: "Étudiants inscrits",
                href: "/professionnel/admin/inscrits",
                icon: Users,
                count: nbInscrits,
              },
              { label: "Paiements", href: "/professionnel/admin/paiements", icon: Wallet },
            ]}
          />
          <MenuGroup
            title="Suivi & Évaluation"
            accent="bg-amber-500"
            entries={[
              { label: "Présences", href: "/professionnel/admin/presences", icon: ClipboardCheck },
              { label: "Conduite", href: "/professionnel/admin/conduite", icon: Star },
              { label: "Notes", href: "/professionnel/admin/notes", icon: ClipboardList },
              {
                label: "Bulletins",
                href: "/professionnel/admin/bulletins",
                icon: FileSpreadsheet,
              },
            ]}
          />
          <MenuGroup
            title="Documents officiels"
            accent="bg-rose-500"
            entries={[
              {
                label: "Attestations de réussite",
                href: "/professionnel/admin/attestations",
                icon: Award,
              },
              {
                label: "Diplômes",
                href: "/professionnel/admin/diplomes",
                icon: GraduationCap,
              },
              { label: "Signataires", href: "/professionnel/admin/signataires", icon: PenLine },
            ]}
          />
        </div>
      </section>

      {chargement && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des indicateurs…
        </p>
      )}
    </div>
  );
}
