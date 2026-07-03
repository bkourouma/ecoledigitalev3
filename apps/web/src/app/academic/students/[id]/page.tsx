"use client";

import { useParams, useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@ecoledigitale/ui";
import {
  ArrowLeft,
  Calendar,
  Edit,
  FileText,
  GraduationCap,
  MapPin,
  Phone,
  User,
} from "lucide-react";
import { useStudent } from "@/lib/hooks/use-students";
import { createApiHeaders } from "@/lib/api-utils";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function StudentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const studentId = params.id as string;
  const { data: student, isLoading, error } = useStudent(studentId);

  const textOrFallback = (value?: string | null) =>
    value && String(value).trim().length > 0 ? value : "—";

  const formatDateOrFallback = (value?: string | Date | null) => {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString("fr-FR");
  };

  const genderLabel = (value?: string | null) => {
    if (value === "masculin") return "Masculin";
    if (value === "feminin") return "Féminin";
    return "—";
  };

  const openDiploma = async (url: string) => {
    try {
      const headers = createApiHeaders();
      delete (headers as any)["Content-Type"];
      delete (headers as any)["content-type"];
      const res = await fetch(`${API_BASE_URL}${url}`, { headers });
      if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e) {
      alert("Impossible d'ouvrir le fichier du diplôme.");
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error || !student) {
    return (
      <div className="container mx-auto px-6 py-8">
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">
              {error ? `Erreur: ${error.message}` : "Étudiant non trouvé"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const diplomaUrl = (student as any).lastDiploma as string | undefined;

  return (
    <div className="container mx-auto max-w-4xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour
          </Button>
          <div>
            <h1 className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-3xl font-bold text-transparent">
              {textOrFallback(student.user?.firstName)} {textOrFallback(student.user?.lastName)}
            </h1>
            <p className="mt-2 text-muted-foreground">Matricule: {student.studentNumber}</p>
          </div>
        </div>
        <Button
          onClick={() => router.push(`/academic/students/${studentId}/edit`)}
          className="bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700"
        >
          <Edit className="mr-2 h-4 w-4" />
          Modifier
        </Button>
      </div>

      <div className="space-y-6">
        {/* Informations personnelles */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Informations personnelles
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Prénom</p>
                <p>{textOrFallback(student.user?.firstName)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Nom</p>
                <p>{textOrFallback(student.user?.lastName)}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Email</p>
                <p>{textOrFallback(student.user?.email)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Sexe</p>
                <p>{genderLabel(student.gender)}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Nationalité</p>
                <p>{textOrFallback(student.nationality)}</p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  Téléphone
                </p>
                <p className="font-mono">{textOrFallback(student.phone)}</p>
              </div>
            </div>
            <div>
              <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                <Calendar className="h-4 w-4" />
                Date de naissance
              </p>
              <p>{formatDateOrFallback(student.dateOfBirth)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Informations complémentaires */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5" />
              Informations complémentaires
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  Lieu de naissance
                </p>
                <p>{textOrFallback(student.placeOfBirth)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Résidence</p>
                <p>{textOrFallback(student.residence)}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Date d'obtention du BAC</p>
                <p>{formatDateOrFallback((student as any).bacObtentionDate)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Série du BAC</p>
                <p>{textOrFallback((student as any).bacSeries)}</p>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Dernier diplôme obtenu</p>
              {diplomaUrl ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  onClick={() => openDiploma(diplomaUrl)}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Voir le fichier
                </Button>
              ) : (
                <p>—</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
