"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createApiHeaders } from "@/lib/api-utils";
import { useCurrentTeacherId } from "@/lib/hooks/use-current-teacher";

type TeacherCourseRow = {
  assignmentCreatedAt?: string | null;
  className?: string | null;
  courseCode?: string | null;
  courseId: string;
  courseName: string;
  hoursValidated?: number | null;
  materialsCount?: number | null;
  status?: string | null;
};

type TeachingHourRow = {
  className?: string | null;
  courseName?: string | null;
  date: string;
  duration?: number | null;
  endTime?: string | null;
  id: string;
  sessionType?: string | null;
  startTime?: string | null;
  status?: string | null;
  validated?: boolean;
};

type TeachingHoursResponse = {
  data?: TeachingHourRow[];
  totals?: {
    pendingHours?: number;
    totalHours?: number;
    validatedHours?: number;
  };
};

type TeacherPaymentRow = {
  approvedAt?: string | null;
  calculatedAt?: string | null;
  id: string;
  paidAt?: string | null;
  periodName?: string | null;
  status: string;
  totalAmount?: number | null;
};

type TeacherPaymentsResponse = {
  data?: TeacherPaymentRow[];
};

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number): string {
  return `${new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(Math.round(value))} FCFA`;
}

function formatShortDate(value?: string | null): string {
  if (!value) return "Date inconnue";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Date inconnue";
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function courseStatusLabel(status?: string | null): string {
  switch (status) {
    case "active":
      return "Actif";
    case "completed":
      return "Termine";
    case "pending":
      return "En attente";
    case "paused":
      return "Suspendu";
    default:
      return "Attribue";
  }
}

function hourStatusLabel(status?: string | null, validated?: boolean): string {
  if (validated) return "Validee";

  switch ((status || "").toLowerCase()) {
    case "completed":
      return "Validee";
    case "pending":
      return "En attente";
    case "draft":
      return "Brouillon";
    case "rejected":
      return "Rejetee";
    default:
      return "Session";
  }
}

function dedupeCourses(courses: TeacherCourseRow[]): TeacherCourseRow[] {
  const byCourseId = new Map<string, TeacherCourseRow>();

  courses.forEach((course) => {
    const existing = byCourseId.get(course.courseId);

    if (!existing) {
      byCourseId.set(course.courseId, course);
      return;
    }

    const currentIsActive = course.status === "active";
    const existingIsActive = existing.status === "active";

    if (currentIsActive && !existingIsActive) {
      byCourseId.set(course.courseId, course);
      return;
    }

    const currentDate = new Date(course.assignmentCreatedAt ?? 0).getTime();
    const existingDate = new Date(existing.assignmentCreatedAt ?? 0).getTime();

    if (currentDate > existingDate) {
      byCourseId.set(course.courseId, course);
    }
  });

  return Array.from(byCourseId.values());
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

export default function TeacherDashboardPage() {
  const { data: session, status } = useSession();
  const {
    data: teacherId,
    isLoading: isLoadingTeacherProfile,
    error: teacherProfileError,
  } = useCurrentTeacherId();
  const roles = (session as { roles?: string[] } | null)?.roles ?? [];
  const isTeacher =
    Array.isArray(roles) &&
    roles.some((role) => ["teacher", "enseignant"].includes(String(role).toLowerCase()));
  const userId =
    ((session as { userId?: string } | null)?.userId ??
      (session?.user as { id?: string } | undefined)?.id) ||
    "";
  const teacherName =
    ((session?.user as { firstName?: string } | undefined)?.firstName ??
      session?.user?.name ??
      "Enseignant") || "Enseignant";

  const headers = useMemo(() => {
    if (!session) return null;
    return createApiHeaders(session, userId ? { "X-User-Id": userId } : undefined);
  }, [session, userId]);
  const hasTeacherProfile = Boolean(teacherId);

  const coursesQuery = useQuery<TeacherCourseRow[]>({
    queryKey: ["teacher-dashboard-courses", teacherId, (session as { tenantId?: string } | null)?.tenantId],
    queryFn: async () => {
      const response = await fetch("/api/teacher/courses", {
        headers: headers || undefined,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          (error as { message?: string }).message || "Impossible de charger les cours de l'enseignant"
        );
      }

      return response.json();
    },
    enabled: !!headers && hasTeacherProfile && isTeacher,
    retry: false,
    staleTime: 60 * 1000,
  });

  const hoursQuery = useQuery<TeachingHoursResponse>({
    queryKey: ["teacher-dashboard-hours", teacherId, (session as { tenantId?: string } | null)?.tenantId],
    queryFn: async () => {
      const response = await fetch("/api/teacher/attendance", {
        headers: headers || undefined,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          (error as { message?: string }).message || "Impossible de charger les heures d'enseignement"
        );
      }

      return response.json();
    },
    enabled: !!headers && hasTeacherProfile && isTeacher,
    retry: false,
    staleTime: 60 * 1000,
  });

  const paymentsQuery = useQuery<TeacherPaymentsResponse>({
    queryKey: ["teacher-dashboard-payments", teacherId, (session as { tenantId?: string } | null)?.tenantId],
    queryFn: async () => {
      const response = await fetch("/api/v1/teacher-payments", {
        headers: headers || undefined,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          (error as { message?: string }).message || "Impossible de charger les paiements de l'enseignant"
        );
      }

      return response.json();
    },
    enabled: !!headers && hasTeacherProfile && isTeacher,
    retry: false,
    staleTime: 60 * 1000,
  });

  if (status === "loading" || isLoadingTeacherProfile) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        Chargement du tableau de bord...
      </div>
    );
  }

  if (!session) {
    redirect("/login");
  }

  if (!isTeacher) {
    redirect("/");
  }

  if (teacherId === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Profil enseignant introuvable
            </CardTitle>
            <CardDescription>
              Ce compte a bien un acces enseignant, mais aucune fiche enseignant n&apos;est rattachee.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Veuillez contacter l&apos;administrateur pour rattacher ce compte a un profil enseignant.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/teacher/profile" className="inline-flex">
                <Badge variant="outline" className="px-3 py-2">
                  Ouvrir mon profil
                </Badge>
              </Link>
              <Link href="/teacher/settings" className="inline-flex">
                <Badge variant="outline" className="px-3 py-2">
                  Ouvrir les parametres
                </Badge>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (teacherProfileError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle className="text-base text-red-700">Erreur</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-red-700">
            {teacherProfileError instanceof Error
              ? teacherProfileError.message
              : "Impossible de verifier le profil enseignant."}
          </CardContent>
        </Card>
      </div>
    );
  }

  const uniqueCourses = dedupeCourses(coursesQuery.data ?? []);
  const teachingHours = hoursQuery.data?.data ?? [];
  const hourTotals = hoursQuery.data?.totals;
  const payments = paymentsQuery.data?.data ?? [];

  const totalValidatedHours =
    toNumber(hourTotals?.validatedHours) ||
    teachingHours
      .filter((hour) => hour.validated || hour.status === "completed")
      .reduce((sum, hour) => sum + toNumber(hour.duration), 0);
  const totalPendingHours =
    toNumber(hourTotals?.pendingHours) ||
    teachingHours
      .filter((hour) => ["pending", "draft"].includes(String(hour.status || "").toLowerCase()))
      .reduce((sum, hour) => sum + toNumber(hour.duration), 0);
  const totalHours = toNumber(hourTotals?.totalHours) || totalValidatedHours + totalPendingHours;
  const totalSupports = uniqueCourses.reduce(
    (sum, course) => sum + toNumber(course.materialsCount),
    0
  );
  const activeCourses = uniqueCourses.filter((course) => course.status === "active").length;
  const coveredClasses = new Set(
    uniqueCourses.map((course) => (course.className || "").trim()).filter(Boolean)
  ).size;

  const totalPaid = payments
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + toNumber(payment.totalAmount), 0);
  const totalPendingPayments = payments
    .filter((payment) =>
      ["pending", "processing", "calculated", "approved"].includes(payment.status)
    )
    .reduce((sum, payment) => sum + toNumber(payment.totalAmount), 0);
  const paidCount = payments.filter((payment) => payment.status === "paid").length;
  const latestPayment = [...payments]
    .sort((left, right) => {
      const leftDate = new Date(left.paidAt ?? left.approvedAt ?? left.calculatedAt ?? 0).getTime();
      const rightDate = new Date(right.paidAt ?? right.approvedAt ?? right.calculatedAt ?? 0).getTime();
      return rightDate - leftDate;
    })
    .find((payment) => Boolean(payment.paidAt || payment.approvedAt || payment.calculatedAt));

  const highlightedCourses = [...uniqueCourses]
    .sort((left, right) => {
      if ((left.status === "active") !== (right.status === "active")) {
        return left.status === "active" ? -1 : 1;
      }

      const leftDate = new Date(left.assignmentCreatedAt ?? 0).getTime();
      const rightDate = new Date(right.assignmentCreatedAt ?? 0).getTime();
      return rightDate - leftDate;
    })
    .slice(0, 5);

  const recentHours = [...teachingHours]
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    .slice(0, 5);

  const kpis = [
    {
      title: "Cours actifs",
      value: String(activeCourses || uniqueCourses.length),
      hint: "Cours actuellement en charge",
      icon: BookOpen,
    },
    {
      title: "Heures validees",
      value: `${totalValidatedHours}h`,
      hint: `${totalPendingHours}h encore en attente`,
      icon: CheckCircle2,
    },
    {
      title: "Charge totale",
      value: `${totalHours}h`,
      hint: `${teachingHours.length} session(s) recensees`,
      icon: Clock3,
    },
    {
      title: "Paiements verses",
      value: formatMoney(totalPaid),
      hint: `${formatMoney(totalPendingPayments)} en attente`,
      icon: Wallet,
    },
  ];

  const hasAnyError = Boolean(coursesQuery.error || hoursQuery.error || paymentsQuery.error);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Tableau de bord</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Vue rapide de l&apos;activite de {teacherName}, avec vos cours, vos heures et vos paiements.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((item) => {
          const Icon = item.icon;

          return (
            <Card key={item.title}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {item.title}
                  </CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tracking-tight">{item.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cours en avant</CardTitle>
            <CardDescription>
              Vos cours les plus recents ou actuellement actifs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {coursesQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement des cours...
              </div>
            ) : coursesQuery.error ? (
              <p className="text-sm text-muted-foreground">
                Les cours ne sont pas disponibles pour le moment.
              </p>
            ) : highlightedCourses.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun cours n&apos;est encore rattache a votre compte.
              </p>
            ) : (
              <div className="space-y-3">
                {highlightedCourses.map((course) => (
                  <div
                    key={course.courseId}
                    className="rounded-xl border border-border bg-muted/30 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">{course.courseName}</p>
                        <p className="text-sm text-muted-foreground">
                          {course.className || "Classe non renseignee"}
                          {course.courseCode ? ` - ${course.courseCode}` : ""}
                        </p>
                      </div>
                      <Badge variant="outline">{courseStatusLabel(course.status)}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {toNumber(course.materialsCount)} support
                        {toNumber(course.materialsCount) > 1 ? "s" : ""}
                      </Badge>
                      <Badge variant="outline">{toNumber(course.hoursValidated)}h remontees</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Heures recentes</CardTitle>
            <CardDescription>
              Suivi des dernieres sessions remontees par votre compte.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hoursQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement des heures...
              </div>
            ) : hoursQuery.error ? (
              <p className="text-sm text-muted-foreground">
                Les heures d&apos;enseignement ne sont pas disponibles pour le moment.
              </p>
            ) : recentHours.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays className="h-4 w-4" />
                Aucune session recente.
              </div>
            ) : (
              <div className="space-y-3">
                {recentHours.map((hour) => (
                  <div key={hour.id} className="rounded-xl border border-border bg-muted/30 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">
                          {hour.courseName || "Session d'enseignement"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {hour.className || "Classe non renseignee"}
                          {hour.startTime && hour.endTime ? ` - ${hour.startTime} - ${hour.endTime}` : ""}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {hourStatusLabel(hour.status, hour.validated)}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{formatShortDate(hour.date)}</span>
                      <span>{toNumber(hour.duration)}h</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Charge d&apos;enseignement</CardTitle>
            <CardDescription>
              Repartition rapide de votre activite pedagogique.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <SummaryMetric label="Cours uniques" value={String(uniqueCourses.length)} />
            <SummaryMetric label="Classes couvertes" value={String(coveredClasses)} />
            <SummaryMetric label="Supports publies" value={String(totalSupports)} />
            <SummaryMetric label="Sessions remontees" value={String(teachingHours.length)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Synthese financiere</CardTitle>
            <CardDescription>
              Lecture rapide de vos reglements et montants en cours.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <SummaryMetric label="Paiements regles" value={String(paidCount)} />
            <SummaryMetric label="Montant paye" value={formatMoney(totalPaid)} />
            <SummaryMetric label="Montant en attente" value={formatMoney(totalPendingPayments)} />
            <SummaryMetric
              label="Derniere echeance"
              value={latestPayment?.periodName || "Aucune"}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Acces rapides</CardTitle>
            <CardDescription>
              Raccourcis vers les ecrans enseignant les plus utiles.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link
              href="/teacher/courses"
              className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-foreground transition-colors hover:bg-muted/50"
            >
              <span className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                Mes cours
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link
              href="/teacher/hours"
              className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-foreground transition-colors hover:bg-muted/50"
            >
              <span className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-muted-foreground" />
                Mes heures
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <Link
              href="/teacher/payments"
              className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-foreground transition-colors hover:bg-muted/50"
            >
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Mes paiements
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
      </div>

      {hasAnyError ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-center gap-3 pt-6 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Certaines donnees du dashboard n&apos;ont pas pu etre chargees, mais la session enseignant reste active.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
