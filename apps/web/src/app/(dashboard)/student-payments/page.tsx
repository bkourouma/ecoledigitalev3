"use client";

import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

const MotionDiv = dynamic(
  () => import("framer-motion").then((mod) => mod.motion.div),
  { ssr: false }
);
import { Alert, AlertDescription } from "@ecoledigitale/ui";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ProfessionalPaymentsTracking } from "./components/ProfessionalPaymentsTracking";
import { useCurrentStudent } from "@/lib/hooks/use-student-data";
import { isStudentProfileMissingError } from "@/lib/student-profile-errors";

/**
 * Mes paiements — espace étudiant.
 *
 * L'écran ne fait plus qu'UNE chose : la traçabilité des règlements du Module
 * Professionnel, en regard de ce que l'administration voit sur
 * `/admin/finances/student-payments`. Ni frais scolaires, ni échéancier, ni
 * formulaire de paiement, ni reçus : les versements sont saisis par la
 * scolarité, l'étudiant les consulte.
 */
export default function StudentPaymentsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();

  // Le profil étudiant n'alimente pas l'écran (l'API travaille sur l'utilisateur
  // authentifié), mais son absence est LA cause d'un écran vide : autant la
  // nommer plutôt que d'afficher « aucune inscription ».
  const {
    isLoading: isLoadingStudent,
    error: currentStudentError,
  } = useCurrentStudent();

  if (sessionStatus === "loading" || isLoadingStudent) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
          <p className="text-muted-foreground">Chargement de vos paiements...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    router.push("/login");
    return null;
  }

  if (currentStudentError) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {isStudentProfileMissingError(currentStudentError)
              ? "Ce compte n'est pas encore rattache a une fiche etudiant. Veuillez contacter l'administrateur."
              : currentStudentError instanceof Error
                ? currentStudentError.message
                : "Impossible de charger le profil etudiant."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      <MotionDiv
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <h1 className="font-bold text-foreground whitespace-nowrap text-2xl leading-tight md:text-3xl">Mes Paiements</h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
          Suivi de vos règlements du Module Professionnel : ce que vous devez, ce qui a été
          encaissé et le détail de vos versements.
        </p>
      </MotionDiv>

      <MotionDiv
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6 }}
      >
        <ProfessionalPaymentsTracking />
      </MotionDiv>
    </div>
  );
}
