import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "À propos",
};

export default function AboutPage() {
  return (
    <div className="container space-y-8 py-10 md:py-14">
      <div className="space-y-4">
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          À propos
        </p>
        <h1 className="font-display text-4xl font-semibold">
          Une plateforme publique pensée pour convertir sans perdre en exigence.
        </h1>
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {[
          "Un catalogue lisible et plus inspiré du e-commerce premium que du back-office brut.",
          "Des pages détaillées qui expliquent clairement les objectifs, modalités et intervenants.",
          "Un tunnel d'inscription court, rassurant et adapté au paiement en ligne.",
        ].map((item) => (
          <div key={item} className="rounded-[1.5rem] border border-border/70 bg-white/85 p-5 shadow-soft">
            <p className="text-sm leading-7 text-muted-foreground">{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
