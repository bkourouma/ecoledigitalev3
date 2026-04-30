import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const metadata: Metadata = {
  title: "Contact",
};

export default function ContactPage() {
  return (
    <div className="container grid gap-8 py-10 md:grid-cols-[0.9fr_1.1fr] md:py-14">
      <section className="space-y-4">
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Contact
        </p>
        <h1 className="font-display text-4xl font-semibold">
          Parlons de vos besoins de formation.
        </h1>
        <p className="text-muted-foreground">
          Demande entreprise, accompagnement au choix de parcours, financement ou
          calendrier des prochaines sessions.
        </p>
      </section>
      <section className="rounded-[1.75rem] border border-border/70 bg-white/85 p-6 shadow-soft">
        <div className="grid gap-4">
          <Input placeholder="Votre nom" aria-label="Votre nom" />
          <Input placeholder="Votre email" type="email" aria-label="Votre email" />
          <Textarea placeholder="Votre message" aria-label="Votre message" />
          <Button>Envoyer la demande</Button>
        </div>
      </section>
    </div>
  );
}
