import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { AffectationWorkspace } from "@/components/dashboard/AffectationWorkspace";
import { EmptyState } from "@/components/shared/EmptyState";
import { isPortalAdminEmail } from "@/lib/admin";
import { getAdminSupportAssignments } from "@/lib/admin-assignments";
import { authOptions } from "@/lib/auth";

export default async function AffectationsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login?next=/affectations");
  }

  if (!isPortalAdminEmail(session.user.email)) {
    redirect("/mes-formations");
  }

  const data = await getAdminSupportAssignments();

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Administration
        </p>
        <h1 className="font-display text-4xl font-semibold">
          Affectation des supports apprenants
        </h1>
      </div>

      {data.supports.length ? (
        <AffectationWorkspace tenants={data.tenants} supports={data.supports} />
      ) : (
        <EmptyState
          title="Aucune affectation à finaliser"
          description="Tous les supports publics ont déjà un vrai formateur et un rattachement satisfaisant."
        />
      )}
    </section>
  );
}
