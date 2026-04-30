import { getServerSession } from "next-auth";
import { EmptyState } from "@/components/shared/EmptyState";
import { VideoLibraryCard } from "@/components/dashboard/VideoLibraryCard";
import { authOptions } from "@/lib/auth";
import { getUserVideoLibrary } from "@/lib/account";

export default async function MesVideosPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) return null;

  const videos = await getUserVideoLibrary(session.user.id);

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Mes vidéos
        </p>
        <h1 className="font-display text-4xl font-semibold">
          Votre bibliothèque vidéo
        </h1>
      </div>

      {videos.length ? (
        <div className="grid gap-5">
          {videos.map((item) => (
            <VideoLibraryCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Aucune vidéo disponible pour le moment"
          description="Confirmez une commande contenant des supports vidéo pour les retrouver ici."
        />
      )}
    </section>
  );
}
