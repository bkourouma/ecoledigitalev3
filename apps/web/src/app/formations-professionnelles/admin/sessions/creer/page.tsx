"use client";

import { useRouter } from "next/navigation";
import { SessionFormWizard } from "@/components/sessions-pro/SessionFormWizard";
import { ArrowLeft } from "lucide-react";
import { Button } from "@ecoledigitale/ui";

export default function CreerSessionPage() {
  const router = useRouter();

  const handleSuccess = (sessionId: string) => {
    router.push("/formations-professionnelles/admin/sessions");
  };

  const handleCancel = () => {
    router.push("/formations-professionnelles/admin/sessions");
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={handleCancel}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Retour à la liste
        </Button>
      </div>

      <SessionFormWizard onSuccess={handleSuccess} onCancel={handleCancel} />
    </div>
  );
}


