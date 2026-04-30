import type { FormationCardData } from "@/types/formation";
import { FormationCard } from "@/components/catalogue/FormationCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonCard } from "@/components/shared/SkeletonCard";

export function CatalogueGrid({
  formations,
  loading,
}: {
  formations: FormationCardData[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    );
  }

  if (!formations.length) {
    return (
      <EmptyState
        title="Aucune formation ne correspond à ces filtres"
        description="Essayez une recherche plus large ou retirez certains critères."
      />
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {formations.map((formation) => (
        <FormationCard key={formation.id} formation={formation} />
      ))}
    </div>
  );
}
