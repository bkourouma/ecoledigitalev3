import type { Metadata } from "next";
import { catalogueFiltersSchema } from "@/lib/schemas";
import { getCatalogue } from "@/lib/catalogue";
import { CatalogueExperience } from "@/components/catalogue/CatalogueExperience";

export const metadata: Metadata = {
  title: "Catalogue",
  description:
    "Explorez les formations professionnelles disponibles, filtrez par niveau, catégorie, mode et budget.",
};

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const parsed = catalogueFiltersSchema.parse({
    search:
      typeof resolvedSearchParams.search === "string"
        ? resolvedSearchParams.search
        : undefined,
    categorie:
      typeof resolvedSearchParams.categorie === "string"
        ? resolvedSearchParams.categorie
        : undefined,
    niveau:
      typeof resolvedSearchParams.niveau === "string"
        ? resolvedSearchParams.niveau
        : undefined,
    mode:
      typeof resolvedSearchParams.mode === "string"
        ? resolvedSearchParams.mode
        : undefined,
    prixMin:
      typeof resolvedSearchParams.prixMin === "string"
        ? resolvedSearchParams.prixMin
        : undefined,
    prixMax:
      typeof resolvedSearchParams.prixMax === "string"
        ? resolvedSearchParams.prixMax
        : undefined,
    page:
      typeof resolvedSearchParams.page === "string"
        ? resolvedSearchParams.page
        : undefined,
    pageSize: 9,
  });

  const initialData = await getCatalogue(parsed);

  return (
    <div className="container space-y-8 py-8 md:py-12">
      <div className="space-y-3">
        <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">
          Catalogue
        </p>
        <h1 className="font-display text-4xl font-semibold">
          Trouvez la bonne formation pour votre prochain palier.
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Filtrez par niveau, budget, modalité et domaine pour identifier rapidement
          la formation la plus pertinente.
        </p>
      </div>
      <CatalogueExperience initialFilters={parsed} initialData={initialData} />
    </div>
  );
}
