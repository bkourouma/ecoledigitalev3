"use client";

import { useParams, useRouter } from "next/navigation";
import { SessionFormWizard } from "@/components/sessions-pro/SessionFormWizard";
import { Card, CardContent } from "@ecoledigitale/ui";
import { Loader2 } from "lucide-react";
import { useSessionDetail } from "@/lib/hooks/use-sessions-pro";

export default function EditSessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const { data: sessionData, isLoading, error } = useSessionDetail(sessionId);

  const handleSuccess = (updatedSessionId: string) => {
    router.push(`/formations-professionnelles/admin/sessions`);
  };

  const handleCancel = () => {
    router.push(`/formations-professionnelles/admin/sessions`);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-foreground/80">Chargement de la session...</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !sessionData?.data) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <p className="text-destructive mb-2">Erreur lors du chargement</p>
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Session introuvable"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <SessionFormWizard
        sessionId={sessionId}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </div>
  );
}

