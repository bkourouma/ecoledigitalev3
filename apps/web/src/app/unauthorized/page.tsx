import Link from "next/link";

/**
 * Accès refusé (cible des gardes serveur `requirePermission` / `requireRole`). Couleurs issues des jetons de thème : les
 * teintes fixes `gray-900` / `gray-600` rendaient le message illisible en thème sombre (balayage QA).
 */
export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold text-foreground">Accès refusé</h1>
      <p className="max-w-md text-sm text-muted-foreground md:text-base">Vous n&apos;avez pas les droits nécessaires pour afficher cette page.</p>
      <Link href="/" className="text-primary underline-offset-4 hover:underline">
        Retour à l&apos;accueil
      </Link>
    </div>
  );
}
