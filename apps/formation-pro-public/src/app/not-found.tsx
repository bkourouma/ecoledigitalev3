import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="container flex min-h-[60vh] flex-col items-center justify-center gap-5 py-16 text-center">
      <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">404</p>
      <h1 className="font-display text-4xl font-semibold">Cette page est introuvable</h1>
      <p className="max-w-xl text-muted-foreground">
        Le lien demandé est peut-être ancien, incorrect ou la ressource n&apos;est plus publique.
      </p>
      <Button asChild>
        <Link href="/catalogue">Retour au catalogue</Link>
      </Button>
    </div>
  );
}
