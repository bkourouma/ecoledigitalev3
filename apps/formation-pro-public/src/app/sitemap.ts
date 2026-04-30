import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  const formations = await prisma.formationProfessionnelle
    .findMany({
      where: {
        actif: true,
        ...(process.env.PUBLIC_FORMATION_TENANT_ID
          ? { tenantId: process.env.PUBLIC_FORMATION_TENANT_ID }
          : {}),
      },
      select: {
        slug: true,
        updatedAt: true,
      },
    })
    .catch(() => []);

  return [
    { url: baseUrl, lastModified: new Date() },
    { url: `${baseUrl}/catalogue`, lastModified: new Date() },
    ...formations
      .filter((formation) => formation.slug)
      .map((formation) => ({
        url: `${baseUrl}/catalogue/${formation.slug}`,
        lastModified: formation.updatedAt || new Date(),
      })),
  ];
}
