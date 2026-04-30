import { Card, CardContent } from "@/components/ui/card";
import type { FormationTrainerData } from "@/types/formation";
import { getInitials } from "@/lib/utils";

export function Formateurs({ formateurs }: { formateurs: FormationTrainerData[] }) {
  if (!formateurs.length) return null;

  return (
    <section className="space-y-4">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Intervenants
        </p>
        <h2 className="font-display text-3xl font-semibold">Une équipe ancrée dans le terrain</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {formateurs.map((formateur) => (
          <Card key={formateur.id}>
            <CardContent className="flex gap-4 p-5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 font-display text-lg font-semibold text-primary">
                {getInitials(formateur.nomComplet.split(" ")[0], formateur.nomComplet.split(" ").slice(1).join(" "))}
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold">{formateur.nomComplet}</h3>
                <p className="text-sm text-muted-foreground">
                  {formateur.bio || "Expert praticien impliqué dans la conception et l'animation du parcours."}
                </p>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  {formateur.specialites.join(" • ") || "Pédagogie active"}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
