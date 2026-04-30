import type { FormationModuleData } from "@/types/formation";

export function ProgrammeAccordion({ modules }: { modules: FormationModuleData[] }) {
  if (!modules.length) return null;

  return (
    <section className="space-y-4">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Programme
        </p>
        <h2 className="font-display text-3xl font-semibold">Ce que vous allez couvrir</h2>
      </div>
      <div className="space-y-3">
        {modules.map((module, index) => (
          <details
            key={`${module.titre}-${index}`}
            className="rounded-[1.5rem] border border-border/70 bg-white/80 p-5 shadow-soft"
            open={index === 0}
          >
            <summary className="cursor-pointer list-none font-semibold">
              {module.titre}
            </summary>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {module.points.map((point) => (
                <li key={point}>• {point}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
