import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold text-gray-900">Accès refusé</h1>
      <p className="text-gray-600 max-w-md whitespace-nowrap text-sm md:text-base">
        Vous n&apos;avez pas les droits nécessaires pour afficher cette page.
      </p>
      <Link href="/" className="text-purple-600 hover:underline">
        Retour à l&apos;accueil
      </Link>
    </div>
  );
}
