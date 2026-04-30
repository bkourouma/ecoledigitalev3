"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import { ArrowLeft } from "lucide-react";
import { CreateScheduleForm } from "../components/CreateScheduleForm";

export default function NewTuitionSchedulePage() {
  const router = useRouter();

  const handleSuccess = () => {
    router.push("/admin/finances/tuition-schedules");
  };

  const handleCancel = () => {
    router.push("/admin/finances/tuition-schedules");
  };

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/admin/finances/tuition-schedules")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Nouvel Échéancier
          </h1>
          <p className="text-muted-foreground mt-2">
            Créez un nouvel échéancier de paiement pour les frais de scolarité
          </p>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Informations de l'échéancier</CardTitle>
          <CardDescription>
            Remplissez les informations pour créer un nouvel échéancier de paiement
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateScheduleForm
            onSuccess={handleSuccess}
            onCancel={handleCancel}
          />
        </CardContent>
      </Card>
    </div>
  );
}

