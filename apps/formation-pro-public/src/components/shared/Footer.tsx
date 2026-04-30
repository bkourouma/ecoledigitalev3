import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-white/50 bg-white/70">
      <div className="container grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-3">
          <p className="font-display text-lg font-semibold">Formation Pro</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Une vitrine publique pour découvrir, financer et suivre des formations
            professionnelles à fort impact.
          </p>
        </div>
        <div className="space-y-3 text-sm">
          <p className="font-semibold">Explorer</p>
          <Link href="/catalogue" className="block text-muted-foreground hover:text-foreground">
            Catalogue
          </Link>
          <Link href="/a-propos" className="block text-muted-foreground hover:text-foreground">
            À propos
          </Link>
          <Link href="/contact" className="block text-muted-foreground hover:text-foreground">
            Contact
          </Link>
        </div>
        <div className="space-y-3 text-sm">
          <p className="font-semibold">Apprenants</p>
          <Link href="/login" className="block text-muted-foreground hover:text-foreground">
            Connexion
          </Link>
          <Link href="/register" className="block text-muted-foreground hover:text-foreground">
            Créer un compte
          </Link>
          <Link href="/mes-formations" className="block text-muted-foreground hover:text-foreground">
            Mes formations
          </Link>
        </div>
      </div>
    </footer>
  );
}
