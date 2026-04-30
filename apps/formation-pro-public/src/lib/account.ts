import { Prisma, StatutInscription } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function isMissingTableError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2021"
  );
}

function uniqueById<T extends { id: string }>(items: T[]) {
  return items.filter(
    (item, index, list) => list.findIndex((current) => current.id === item.id) === index
  );
}

function inferSupportKind(support: {
  typeFichier: string | null;
  videoProvider: string | null;
  fichierUrl: string;
}) {
  const fileType = (support.typeFichier || "").toLowerCase();
  const fileUrl = support.fichierUrl.toLowerCase();

  if (support.videoProvider || fileType.includes("video")) return "video" as const;
  if (fileType.includes("pdf") || fileUrl.endsWith(".pdf")) return "pdf" as const;
  if (
    fileType.includes("ppt") ||
    fileType.includes("doc") ||
    fileType.includes("presentation") ||
    fileType.includes("document")
  ) {
    return "document" as const;
  }

  return "link" as const;
}

export interface UserOrderData {
  id: string;
  statut: "EN_ATTENTE" | "CONFIRME" | "ANNULE";
  codePaiement: string;
  montantPaye: number;
  dateInscription: string;
  dateConfirmation: string | null;
  moyenPaiement: string | null;
  referencePaiement: string | null;
  formation: {
    titre: string;
    slug: string;
  };
  session: {
    codeSession: string | null;
    dateDebut: string;
  } | null;
}

export interface UserVideoData {
  id: string;
  titre: string;
  description: string | null;
  formateurNom: string;
  sessionCode: string | null;
  createdAt: string | null;
  formationTitle: string;
  formationSlug: string;
}

export interface UserDashboardSummary {
  totalOrders: number;
  confirmedOrders: number;
  pendingOrders: number;
  activeFormations: number;
  availableVideos: number;
}

export async function getUserOrders(userId: string): Promise<UserOrderData[]> {
  try {
    const rows = await prisma.inscriptionPublic.findMany({
      where: { userId },
      orderBy: { dateInscription: "desc" },
      include: {
        formation: true,
        session: true,
      },
    });

    return rows.map((item) => ({
      id: item.id,
      statut: item.statut,
      codePaiement: item.codePaiement,
      montantPaye: Number(item.montantPaye),
      dateInscription: item.dateInscription.toISOString(),
      dateConfirmation: item.dateConfirmation?.toISOString() || null,
      moyenPaiement: item.moyenPaiement,
      referencePaiement: item.referencePaiement,
      formation: {
        titre: item.formation.titre,
        slug: item.formation.slug || item.formation.id,
      },
      session: item.session
        ? {
            codeSession: item.session.codeSession,
            dateDebut: item.session.dateDebut.toISOString(),
          }
        : null,
    }));
  } catch (error) {
    if (isMissingTableError(error)) {
      return [];
    }

    throw error;
  }
}

export async function getUserVideoLibrary(userId: string): Promise<UserVideoData[]> {
  try {
    const enrollments = await prisma.inscriptionPublic.findMany({
      where: {
        userId,
        statut: StatutInscription.CONFIRME,
      },
      include: {
        formation: true,
        session: true,
      },
    });

    if (!enrollments.length) return [];

    const formationIds = Array.from(new Set(enrollments.map((item) => item.formationId)));
    const sessionIds = Array.from(
      new Set(enrollments.map((item) => item.sessionId).filter(Boolean) as string[])
    );
    const enrollmentByFormationId = new Map(
      enrollments.map((item) => [item.formationId, item.formation])
    );
    const enrollmentBySessionId = new Map(
      enrollments
        .filter((item) => item.sessionId)
        .map((item) => [item.sessionId as string, item.formation])
    );
    const sessionById = new Map(
      enrollments
        .filter((item) => item.session)
        .map((item) => [
          item.session!.id,
          {
            id: item.session!.id,
            codeSession: item.session!.codeSession,
          },
        ])
    );

    const supports = await prisma.supportCours.findMany({
      where: {
        visibleApprenants: true,
        OR: [
          { formationId: { in: formationIds } },
          ...(sessionIds.length ? [{ sessionId: { in: sessionIds } }] : []),
          ...(sessionIds.length
            ? [
                {
                  supportAssociations: {
                    some: {
                      sessionId: { in: sessionIds },
                    },
                  },
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: "asc" }, { titre: "asc" }],
      include: {
        formation: true,
        session: true,
        formateur: true,
        supportAssociations: sessionIds.length
          ? {
              where: {
                sessionId: { in: sessionIds },
              },
            }
          : false,
      },
    });

    return uniqueById(
      supports
        .map((support) => {
          const kind = inferSupportKind(support);
          if (kind !== "video") return null;

          const associatedSessionId =
            support.session?.id || support.supportAssociations?.[0]?.sessionId || null;
          const relatedSession =
            support.session ||
            (associatedSessionId ? sessionById.get(associatedSessionId) : null) ||
            null;
          const relatedFormation =
            support.formation ||
            (support.formationId ? enrollmentByFormationId.get(support.formationId) : null) ||
            (associatedSessionId ? enrollmentBySessionId.get(associatedSessionId) : null) ||
            null;

          if (!relatedFormation) return null;

          return {
            id: support.id,
            titre: support.titre,
            description: support.description,
            formateurNom: `${support.formateur.prenom} ${support.formateur.nom}`.trim(),
            sessionCode: relatedSession?.codeSession || null,
            createdAt: support.createdAt?.toISOString() || null,
            formationTitle: relatedFormation.titre,
            formationSlug: relatedFormation.slug || relatedFormation.id,
          };
        })
        .filter(Boolean) as UserVideoData[]
    );
  } catch (error) {
    if (isMissingTableError(error)) {
      return [];
    }

    throw error;
  }
}

export async function getUserDashboardSummary(
  userId: string
): Promise<UserDashboardSummary> {
  const [orders, videos] = await Promise.all([
    getUserOrders(userId),
    getUserVideoLibrary(userId),
  ]);

  return {
    totalOrders: orders.length,
    confirmedOrders: orders.filter((item) => item.statut === "CONFIRME").length,
    pendingOrders: orders.filter((item) => item.statut === "EN_ATTENTE").length,
    activeFormations: new Set(
      orders
        .filter((item) => item.statut === "CONFIRME")
        .map((item) => item.formation.slug)
    ).size,
    availableVideos: videos.length,
  };
}
