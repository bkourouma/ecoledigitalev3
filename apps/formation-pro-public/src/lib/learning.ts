import { Prisma, StatutInscription } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { FormationDetailData } from "@/types/formation";

function isMissingTableError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2021"
  );
}

export interface LearningSupportData {
  id: string;
  titre: string;
  description: string | null;
  typeFichier: string | null;
  fichierUrl: string;
  videoProvider: string | null;
  videoId: string | null;
  thumbnailUrl: string | null;
  createdAt: string | null;
  formateurNom: string;
  sessionCode: string | null;
  kind: "video" | "pdf" | "document" | "link";
}

export interface LearningWorkspaceData {
  enrollmentId: string;
  formation: FormationDetailData;
  session: {
    id: string;
    codeSession: string | null;
    dateDebut: string;
  } | null;
  supports: LearningSupportData[];
}

function toStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function toModules(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return [];

  return value.map((module, index) => {
    if (typeof module === "string") {
      return { titre: `Module ${index + 1}`, points: [module] };
    }

    if (typeof module === "object" && module) {
      const record = module as Record<string, unknown>;
      return {
        titre: String(record.titre || record.title || `Module ${index + 1}`),
        points: Array.isArray(record.points)
          ? record.points.map(String)
          : Array.isArray(record.contenu)
            ? record.contenu.map(String)
            : [],
      };
    }

    return { titre: `Module ${index + 1}`, points: [] };
  });
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

export async function getLearningWorkspace(
  userId: string,
  slug: string
): Promise<LearningWorkspaceData | null> {
  try {
    const enrollment = await prisma.inscriptionPublic.findFirst({
      where: {
        userId,
        statut: StatutInscription.CONFIRME,
        formation: {
          slug,
          actif: true,
        },
      },
      include: {
        formation: {
          include: {
            sessions: {
              orderBy: { dateDebut: "asc" },
              include: {
                sessionFormateurs: {
                  include: {
                    formateur: true,
                  },
                },
              },
            },
          },
        },
        session: true,
      },
    });

    if (!enrollment) return null;

    const rawSupports = await prisma.supportCours.findMany({
      where: {
        tenantId: enrollment.formation.tenantId,
        visibleApprenants: true,
        OR: [
          { formationId: enrollment.formationId },
          ...(enrollment.sessionId
            ? [
                { sessionId: enrollment.sessionId },
                {
                  supportAssociations: {
                    some: {
                      sessionId: enrollment.sessionId,
                    },
                  },
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: "asc" }, { titre: "asc" }],
      include: {
        formateur: true,
        session: true,
      },
    });

    const supports = uniqueById(rawSupports).map((support) => ({
      id: support.id,
      titre: support.titre,
      description: support.description,
      typeFichier: support.typeFichier,
      fichierUrl: support.fichierUrl,
      videoProvider: support.videoProvider,
      videoId: support.videoId,
      thumbnailUrl: support.urlThumbnail,
      createdAt: support.createdAt?.toISOString() || null,
      formateurNom: `${support.formateur.prenom} ${support.formateur.nom}`.trim(),
      sessionCode: support.session?.codeSession || enrollment.session?.codeSession || null,
      kind: inferSupportKind(support),
    }));

    const uniqueFormateurs = uniqueById(
      enrollment.formation.sessions.flatMap((session) =>
        session.sessionFormateurs.map(({ formateur }) => ({
          id: formateur.id,
          nomComplet: `${formateur.prenom} ${formateur.nom}`.trim(),
          bio: formateur.bio,
          photoUrl: formateur.photoUrl,
          specialites: toStringArray(formateur.specialites),
        }))
      )
    );

    const formation: FormationDetailData = {
      id: enrollment.formation.id,
      slug: enrollment.formation.slug || enrollment.formation.id,
      titre: enrollment.formation.titre,
      descriptionCourte:
        enrollment.formation.descriptionCourte ||
        "Formation débloquée dans votre espace apprenant.",
      prix: enrollment.formation.prixTtc ? Number(enrollment.formation.prixTtc) : 0,
      niveau: enrollment.formation.niveau || "Tous niveaux",
      dureeHeures: enrollment.formation.dureeHeures || 0,
      dureeJours: enrollment.formation.dureeJours || 0,
      mode: enrollment.session?.modeFormation || "Parcours débloqué",
      themes: toStringArray(enrollment.formation.themes),
      formateurNom: uniqueFormateurs[0]?.nomComplet || "Équipe Formation Pro",
      prochaineSession: enrollment.session?.dateDebut.toISOString() || null,
      placesRestantes: null,
      descriptionComplete:
        enrollment.formation.descriptionComplete ||
        enrollment.formation.descriptionCourte ||
        "Formation débloquée dans votre espace apprenant.",
      prerequis: enrollment.formation.prerequis,
      publicCible: enrollment.formation.publicCible,
      objectifs: toStringArray(enrollment.formation.objectifs),
      modules: toModules(enrollment.formation.programmeDetaille),
      formateurs: uniqueFormateurs,
      sessions: enrollment.formation.sessions.map((session) => ({
        id: session.id,
        codeSession: session.codeSession || "Session",
        dateDebut: session.dateDebut.toISOString(),
        dateFin: session.dateFin.toISOString(),
        mode: session.modeFormation,
        lieu: session.lieu,
        prix: session.prixTtc ? Number(session.prixTtc) : null,
        placesRestantes: session.placesTotales - (session.placesReservees || 0),
      })),
      certification:
        enrollment.formation.nomCertification || enrollment.formation.typeCertification,
      brochurePdfUrl: enrollment.formation.brochurePdfUrl,
    };

    return {
      enrollmentId: enrollment.id,
      formation,
      session: enrollment.session
        ? {
            id: enrollment.session.id,
            codeSession: enrollment.session.codeSession,
            dateDebut: enrollment.session.dateDebut.toISOString(),
          }
        : null,
      supports,
    };
  } catch (error) {
    if (isMissingTableError(error)) {
      return null;
    }

    throw error;
  }
}

export async function getLearningSupport(
  userId: string,
  slug: string,
  supportId: string
) {
  const workspace = await getLearningWorkspace(userId, slug);
  if (!workspace) return null;

  const support = workspace.supports.find((item) => item.id === supportId);
  if (!support) return null;

  return { workspace, support };
}
