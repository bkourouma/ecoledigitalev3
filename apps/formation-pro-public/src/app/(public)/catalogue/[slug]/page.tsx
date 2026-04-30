import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { notFound } from "next/navigation";
import { CTAInscription } from "@/components/formation/CTAInscription";
import { Formateurs } from "@/components/formation/Formateurs";
import { HeroFormation } from "@/components/formation/HeroFormation";
import { ProgrammeAccordion } from "@/components/formation/ProgrammeAccordion";
import { hasConfirmedEnrollment, getFormationBySlug } from "@/lib/catalogue";
import { authOptions } from "@/lib/auth";
import { absoluteUrl } from "@/lib/utils";
import { prisma } from "@/lib/prisma";

export async function generateStaticParams() {
  const rows = await prisma.formationProfessionnelle
    .findMany({
      where: {
        actif: true,
        ...(process.env.PUBLIC_FORMATION_TENANT_ID
          ? { tenantId: process.env.PUBLIC_FORMATION_TENANT_ID }
          : {}),
      },
      select: { slug: true },
    })
    .catch(() => []);

  return rows
    .filter((row) => row.slug)
    .map((row) => ({ slug: row.slug as string }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const formation = await getFormationBySlug(slug);

  if (!formation) {
    return {
      title: "Formation introuvable",
    };
  }

  return {
    title: formation.titre,
    description: formation.descriptionCourte,
    openGraph: {
      title: formation.titre,
      description: formation.descriptionCourte,
      url: absoluteUrl(`/catalogue/${formation.slug}`),
      type: "article",
    },
  };
}

export default async function FormationDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const formation = await getFormationBySlug(slug);

  if (!formation) {
    notFound();
  }

  const session = await getServerSession(authOptions);
  const hasAccess = session?.user?.id
    ? await hasConfirmedEnrollment(session.user.id, formation.id)
    : false;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: formation.titre,
    description: formation.descriptionCourte,
    provider: {
      "@type": "Organization",
      name: "Formation Pro",
      url: absoluteUrl("/"),
    },
    offers: {
      "@type": "Offer",
      priceCurrency: "XOF",
      price: formation.prix,
      availability: "https://schema.org/InStock",
      url: absoluteUrl(`/catalogue/${formation.slug}`),
    },
  };

  return (
    <div className="container space-y-10 py-8 pb-28 md:pb-12">
      <HeroFormation formation={formation} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-10">
          <section className="space-y-4 rounded-[1.75rem] border border-border/70 bg-white/80 p-6 shadow-soft">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
                Objectifs
              </p>
              <h2 className="font-display text-3xl font-semibold">Ce que vous allez maîtriser</h2>
            </div>
            <ul className="grid gap-3 text-sm leading-7 text-muted-foreground md:grid-cols-2">
              {formation.objectifs.length ? (
                formation.objectifs.map((item) => <li key={item}>• {item}</li>)
              ) : (
                <li>• Une trajectoire concrète, applicable dans votre contexte professionnel.</li>
              )}
            </ul>
          </section>

          <ProgrammeAccordion modules={formation.modules} />
          <Formateurs formateurs={formation.formateurs} />
        </div>

        <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <CTAInscription formation={formation} hasAccess={hasAccess} />
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}
