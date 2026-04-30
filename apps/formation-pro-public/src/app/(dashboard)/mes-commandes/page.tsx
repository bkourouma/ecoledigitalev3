import Link from "next/link";
import { getServerSession } from "next-auth";
import { EmptyState } from "@/components/shared/EmptyState";
import { OrderCard } from "@/components/dashboard/OrderCard";
import { Button } from "@/components/ui/button";
import { authOptions } from "@/lib/auth";
import { getUserOrders } from "@/lib/account";

export default async function MesCommandesPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) return null;

  const orders = await getUserOrders(session.user.id);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
            Mes commandes
          </p>
          <h1 className="font-display text-4xl font-semibold">
            Historique des achats
          </h1>
        </div>
        <Button asChild variant="outline">
          <Link href="/catalogue">Explorer le catalogue</Link>
        </Button>
      </div>

      {orders.length ? (
        <div className="grid gap-5">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Aucune commande pour le moment"
          description="Vos paiements et vos confirmations apparaîtront ici après votre première inscription."
        />
      )}
    </section>
  );
}
