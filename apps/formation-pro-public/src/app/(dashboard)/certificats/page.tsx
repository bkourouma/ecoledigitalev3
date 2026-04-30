import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function CertificatsPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl">Certificats</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-sm text-muted-foreground">
          Les certificats téléchargeables seront disponibles ici pour les formations terminées.
        </CardContent>
      </Card>
      <EmptyState
        title="Aucun certificat disponible"
        description="Terminez une formation confirmée pour débloquer vos attestations."
      />
    </div>
  );
}
