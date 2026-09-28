"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import {
  ArrowLeft,
  AlertCircle,
  Loader2,
  FileText,
  ClipboardList,
  Video,
  Info,
  BookOpen,
  Calendar,
  Receipt,
} from "lucide-react";
import {
  useMyProfessionalEnrollments,
  useStudentSessionEcue,
} from "@/lib/hooks/use-professional-student";
import { SubjectMaterialsPanel } from "@/components/professional/SubjectMaterialsPanel";
import { StudentAssignmentsPanel } from "@/components/professional/StudentAssignmentsPanel";

const LIST_URL = "/student/courses";

const STATUT_LABEL: Record<string, string> = {
  en_attente_paiement: "En attente de paiement",
  confirmee: "Confirmée",
  terminee: "Terminée",
  annulee: "Annulée",
};

type Tab = "infos" | "supports" | "evaluations" | "visio";

/** La Conduite n'est pas une matière (ecue) — filtrée partout. */
function isConduiteEcue(e: any): boolean {
  const lib = String(e?.libelle ?? "").toLowerCase();
  const code = String(e?.code ?? "").toUpperCase();
  return lib.startsWith("conduite") || code.includes("EC-CON");
}

function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR");
}

export default function StudentCourseDetailPage() {
  const router = useRouter();
  const params = useParams();
  const enrollmentId = String(params?.id ?? "");
  const [tab, setTab] = useState<Tab>("infos");
  const [selectedEcueId, setSelectedEcueId] = useState<string>("");

  const query = useMyProfessionalEnrollments();
  const enrollments: any[] = (query.data as any[]) ?? [];

  const enrollment = useMemo(
    () => enrollments.find((e) => e.id === enrollmentId),
    [enrollments, enrollmentId]
  );

  const isActive = enrollment?.statut === "confirmee" || enrollment?.statut === "terminee";

  // ECUE débloquées par cette inscription (UE → plusieurs ECUE), hors Conduite.
  const ecueQuery = useStudentSessionEcue(
    isActive ? (enrollment?.ue_session_id ?? null) : null
  );
  const ecueList: any[] = useMemo(
    () => ((ecueQuery.data as any[]) ?? []).filter((e) => !isConduiteEcue(e)),
    [ecueQuery.data]
  );

  useEffect(() => {
    if (!selectedEcueId && ecueList.length > 0) {
      setSelectedEcueId(ecueList[0].id);
    }
  }, [ecueList, selectedEcueId]);

  if (query.isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <Card>
          <CardContent className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-green-600" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!enrollment) {
    return (
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-8 w-8 text-red-600 mb-3" />
            <p className="text-muted-foreground">Cours introuvable ou non accessible.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
    { id: "infos", label: "Informations", icon: Info },
    { id: "supports", label: "Supports de cours", icon: FileText },
    { id: "evaluations", label: "Évaluations & notes", icon: ClipboardList },
    { id: "visio", label: "Séances visio", icon: Video },
  ];

  const EcueSelector = () => (
    <div className="mb-4 max-w-md">
      <label className="text-sm font-medium mb-1.5 block">ECUE</label>
      <Select value={selectedEcueId} onValueChange={setSelectedEcueId}>
        <SelectTrigger>
          <SelectValue placeholder="Choisir une ECUE" />
        </SelectTrigger>
        <SelectContent>
          {ecueList.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.code} — {e.libelle}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-6">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
        <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:mb-8 md:gap-3">
          <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Button>
          <div>
            <p className="font-mono text-xs text-muted-foreground">{enrollment.ue_code}</p>
            <h1 className="whitespace-nowrap font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent leading-tight text-2xl md:text-3xl">
              {enrollment.ue_libelle}
            </h1>
            <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">{enrollment.session_libelle}</p>
          </div>
        </div>
        <span
          className={`px-3 py-1.5 rounded-full text-sm font-medium ${
            enrollment.statut === "confirmee"
              ? "bg-green-100 text-green-700"
              : enrollment.statut === "terminee"
                ? "bg-blue-100 text-blue-700"
                : enrollment.statut === "en_attente_paiement"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-gray-100 text-gray-700"
          }`}
        >
          {STATUT_LABEL[enrollment.statut] ?? enrollment.statut}
        </span>
      </div>

      {!isActive && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Votre inscription n'est pas encore active. Les supports, évaluations et séances visio ne
          seront accessibles qu'une fois votre paiement validé.
        </div>
      )}

      <div className="border-b border-border">
        <nav className="flex flex-wrap gap-2">
          {TABS.map(({ id, label, icon: Icon }) => {
            const isActiveTab = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  isActiveTab
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      {tab === "infos" && (
        <Card>
          <CardHeader>
            <CardTitle>Informations du cours</CardTitle>
            <CardDescription>Détails de la session d'UE à laquelle vous êtes inscrit.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              {enrollment.session_libelle}
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {fmtDate(enrollment.date_debut)} → {fmtDate(enrollment.date_fin)}
            </div>
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              Référence&nbsp;: <span className="font-mono">{enrollment.order_reference}</span>
            </div>
            <div className="text-muted-foreground">
              Inscrit le {new Date(enrollment.created_at).toLocaleString("fr-FR")}
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "supports" && isActive && (
        <div>
          <EcueSelector />
          {selectedEcueId ? (
            <SubjectMaterialsPanel
              subjectId={selectedEcueId}
              canManage={false}
              canViewStats={false}
              title="Supports de cours"
              description="Lecture seule via le site — le téléchargement est désactivé. PDF, vidéo et images s'ouvrent directement dans le navigateur."
            />
          ) : (
            <p className="text-sm text-muted-foreground">Aucune ECUE disponible.</p>
          )}
        </div>
      )}
      {tab === "supports" && !isActive && <InactiveNotice />}

      {tab === "evaluations" && isActive && (
        <div>
          <EcueSelector />
          {selectedEcueId ? (
            <StudentAssignmentsPanel subjectId={selectedEcueId} />
          ) : (
            <p className="text-sm text-muted-foreground">Aucune ECUE disponible.</p>
          )}
        </div>
      )}
      {tab === "evaluations" && !isActive && <InactiveNotice />}

      {tab === "visio" && isActive && (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Video className="h-8 w-8 mx-auto text-blue-500" />
            <p className="text-sm text-muted-foreground">
              Les séances visio sont rattachées aux séances planifiées de votre ECUE par
              l'enseignant. Le lien de connexion vous sera communiqué pour chaque séance.
            </p>
          </CardContent>
        </Card>
      )}
      {tab === "visio" && !isActive && <InactiveNotice />}
    </div>
  );
}

function InactiveNotice() {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <AlertCircle className="h-8 w-8 mx-auto text-amber-500 mb-3" />
        <p className="text-sm text-muted-foreground">
          Section disponible une fois votre inscription confirmée.
        </p>
      </CardContent>
    </Card>
  );
}
