import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { isPortalAdminEmail } from "@/lib/admin";
import { authOptions } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login?next=/compte");
  }

  const links = [
    { href: "/compte", label: "Mon compte" },
    { href: "/mes-videos", label: "Mes vidéos" },
    { href: "/mes-commandes", label: "Mes commandes" },
    { href: "/mes-formations", label: "Mes formations" },
    { href: "/profil", label: "Profil" },
    { href: "/certificats", label: "Certificats" },
    ...(isPortalAdminEmail(session.user.email)
      ? [{ href: "/affectations", label: "Affectations" }]
      : []),
  ];

  return (
    <div className="container grid gap-6 py-8 md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="h-fit rounded-[1.75rem] border border-border/70 bg-white/85 p-5 shadow-soft">
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Espace apprenant</p>
        <p className="mt-3 font-display text-2xl font-semibold">
          {session.user.prenom || session.user.name || "Bienvenue"}
        </p>
        <nav className="mt-6 grid gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-2xl px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div>{children}</div>
    </div>
  );
}
