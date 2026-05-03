import Link from "next/link";
import { ArrowRight, BadgeCheck, Globe2, Layers3, ShieldCheck } from "lucide-react";
import { getPopularFormations } from "@/lib/catalogue";
import { FormationCard } from "@/components/catalogue/FormationCard";
import { Button } from "@/components/ui/button";

const testimonials = [
  {
    quote:
      "Le parcours était concret, exigeant et directement exploitable dans mon quotidien de responsable projet.",
    author: "Aissatou D.",
    role: "Cheffe de projet digital",
  },
  {
    quote:
      "J'ai pu financer la formation, suivre les sessions à distance et repartir avec une vraie feuille de route.",
    author: "Kouame Y.",
    role: "Consultant data junior",
  },
];

export default async function HomePage() {
  const popularFormations = await getPopularFormations();

  return (
    <div className="pb-16">
      <section className="hero-grid border-b border-white/40">
        <div className="container grid gap-12 py-12 md:py-20 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-primary shadow-soft">
              <BadgeCheck className="h-4 w-4" />
              Portail public de formation professionnelle
            </div>
            <div className="space-y-5">
              <h1 className="max-w-4xl font-display text-5xl font-semibold tracking-tight sm:text-6xl">
                Montez en compétence avec des parcours concrets, visibles et finançables.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                Explorez un catalogue moderne, choisissez votre session, payez en ligne
                et retrouvez vos acquisitions depuis un espace personnel simple.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild className="w-full sm:w-auto">
                <Link href="/catalogue">
                  Découvrir les formations
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link href="/register">Créer mon compte</Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-4 self-start">
            <div className="animate-float rounded-[2rem] border border-white/60 bg-white/90 p-6 shadow-lift">
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                Résultat attendu
              </p>
              <p className="mt-3 font-display text-3xl font-semibold">
                Un parcours plus lisible et une inscription plus fluide.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Metric label="Taux d'engagement" value="92%" />
              <Metric label="Formats hybrides" value="4" />
            </div>
          </div>
        </div>
      </section>

      <section className="container py-14 md:py-20">
        <div className="grid gap-4 md:grid-cols-4">
          <ValueCard icon={<Layers3 className="h-5 w-5" />} title="Catalogue clair" description="Des formations racontées comme des offres produit, pas comme une liste brute." />
          <ValueCard icon={<Globe2 className="h-5 w-5" />} title="Accessible partout" description="Mobile-first, simple à parcourir et lisible sur petits écrans." />
          <ValueCard icon={<ShieldCheck className="h-5 w-5" />} title="Paiement sécurisé" description="Paiement en ligne via PayHubSecure et suivi de transaction." />
          <ValueCard icon={<BadgeCheck className="h-5 w-5" />} title="Suivi apprenant" description="Espace personnel pour retrouver inscriptions et certificats." />
        </div>
      </section>

      <section className="container space-y-6 py-8 md:py-12">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
              Catalogue
            </p>
            <h2 className="font-display text-3xl font-semibold">Formations populaires</h2>
          </div>
          <Button asChild variant="outline">
            <Link href="/catalogue">Voir tout le catalogue</Link>
          </Button>
        </div>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {popularFormations.map((formation) => (
            <FormationCard key={formation.id} formation={formation} />
          ))}
        </div>
      </section>

      <section className="container grid gap-5 py-14 md:grid-cols-2">
        {testimonials.map((item) => (
          <div key={item.author} className="rounded-[1.75rem] border border-border/70 bg-white/85 p-6 shadow-soft">
            <p className="text-lg leading-8 text-foreground">“{item.quote}”</p>
            <div className="mt-5">
              <p className="font-semibold">{item.author}</p>
              <p className="text-sm text-muted-foreground">{item.role}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="container pb-8">
        <div className="rounded-[2rem] bg-slate-950 px-6 py-10 text-white shadow-lift sm:px-10">
          <p className="text-sm uppercase tracking-[0.2em] text-white/60">Newsletter</p>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-display text-3xl font-semibold">
                Recevez les nouvelles sessions et les ouvertures d&apos;inscription.
              </h2>
              <p className="mt-2 max-w-2xl text-white/70">
                Une communication utile, focalisée sur les démarrages de cohortes et les dates importantes à ne pas manquer.
              </p>
            </div>
            <Button asChild>
              <Link href="/register">Je veux être informé</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/60 bg-white/85 p-5 shadow-soft">
      <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{label}</p>
      <p className="mt-3 font-display text-3xl font-semibold">{value}</p>
    </div>
  );
}

function ValueCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-border/70 bg-white/80 p-5 shadow-soft">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}
