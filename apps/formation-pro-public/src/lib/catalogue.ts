import {
  Prisma,
  SessionProfessionalStatus,
  StatutInscription,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  CatalogueResponse,
  FormationCardData,
  FormationDetailData,
  FormationModuleData,
  FormationTrainerData,
} from "@/types/formation";

const DEFAULT_TENANT_ID = process.env.PUBLIC_FORMATION_TENANT_ID || "";

function isMissingTableError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2021"
  );
}

export interface CatalogueFilters {
  search?: string;
  categorie?: string;
  niveau?: string;
  mode?: string;
  prixMin?: number;
  prixMax?: number;
  page?: number;
  pageSize?: number;
}

function toStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) =>
        typeof item === "string"
          ? item
          : typeof item === "object" && item && "label" in item
            ? String((item as Record<string, unknown>).label)
            : []
      )
      .filter(Boolean);
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .flatMap((item) => (typeof item === "string" ? [item] : []))
      .filter(Boolean);
  }

  return [];
}

function toModuleList(value: Prisma.JsonValue | null | undefined): FormationModuleData[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item, index) => {
        if (typeof item === "string") {
          return { titre: `Module ${index + 1}`, points: [item] };
        }

        if (typeof item === "object" && item) {
          const record = item as Record<string, unknown>;
          const points = Array.isArray(record.points)
            ? record.points.map((point) => String(point))
            : Array.isArray(record.contenu)
              ? record.contenu.map((point) => String(point))
              : [];

          return {
            titre: String(record.titre || record.title || `Module ${index + 1}`),
            points,
          };
        }

        return null;
      })
      .filter(Boolean) as FormationModuleData[];
  }

  return [];
}

function formatMode(mode: string) {
  switch (mode) {
    case "PRESENTIAL":
      return "Présentiel";
    case "REMOTE":
      return "Distanciel";
    case "HYBRID":
      return "Hybride";
    case "ELEARNING":
      return "E-learning";
    default:
      return mode;
  }
}

function mapTrainer(sessionFormateurs: Array<{
  formateur: {
    id: string;
    nom: string;
    prenom: string;
    bio: string | null;
    photoUrl: string | null;
    specialites: Prisma.JsonValue | null;
  };
}>): FormationTrainerData[] {
  return sessionFormateurs.map(({ formateur }) => ({
    id: formateur.id,
    nomComplet: `${formateur.prenom} ${formateur.nom}`.trim(),
    bio: formateur.bio,
    photoUrl: formateur.photoUrl,
    specialites: toStringArray(formateur.specialites),
  }));
}

function mapFormationCard(formation: {
  id: string;
  slug: string | null;
  titre: string;
  descriptionCourte: string | null;
  prixTtc: Prisma.Decimal | null;
  niveau: string | null;
  dureeHeures: number | null;
  dureeJours: number | null;
  themes: Prisma.JsonValue | null;
  sessions: Array<{
    id: string;
    dateDebut: Date;
    modeFormation: string;
    placesTotales: number;
    placesReservees: number | null;
    sessionFormateurs: Array<{
      formateur: { nom: string; prenom: string };
    }>;
  }>;
}): FormationCardData {
  const firstSession = formation.sessions[0];
  const firstTrainer = firstSession?.sessionFormateurs[0]?.formateur;

  return {
    id: formation.id,
    slug: formation.slug || formation.id,
    titre: formation.titre,
    descriptionCourte:
      formation.descriptionCourte ||
      "Programme professionnalisant accessible en ligne ou en présentiel.",
    prix: formation.prixTtc ? Number(formation.prixTtc) : 0,
    niveau: formation.niveau || "Tous niveaux",
    dureeHeures: formation.dureeHeures || 0,
    dureeJours: formation.dureeJours || 0,
    mode: firstSession ? formatMode(firstSession.modeFormation) : "Sur mesure",
    themes: toStringArray(formation.themes),
    formateurNom: firstTrainer
      ? `${firstTrainer.prenom} ${firstTrainer.nom}`
      : "Équipe Formation Pro",
    prochaineSession: firstSession?.dateDebut.toISOString() || null,
    placesRestantes: firstSession
      ? firstSession.placesTotales - (firstSession.placesReservees || 0)
      : null,
  };
}

function buildWhere(filters: CatalogueFilters): Prisma.FormationProfessionnelleWhereInput {
  const where: Prisma.FormationProfessionnelleWhereInput = {
    actif: true,
  };

  if (DEFAULT_TENANT_ID) {
    where.tenantId = DEFAULT_TENANT_ID;
  }

  if (filters.search) {
    where.OR = [
      { titre: { contains: filters.search, mode: "insensitive" } },
      { descriptionCourte: { contains: filters.search, mode: "insensitive" } },
      { descriptionComplete: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  if (filters.niveau) {
    where.niveau = { equals: filters.niveau, mode: "insensitive" };
  }

  if (filters.categorie) {
    where.themes = { array_contains: [filters.categorie] };
  }

  if (filters.prixMin !== undefined || filters.prixMax !== undefined) {
    where.prixTtc = {};
    if (filters.prixMin !== undefined) where.prixTtc.gte = filters.prixMin;
    if (filters.prixMax !== undefined) where.prixTtc.lte = filters.prixMax;
  }

  if (filters.mode) {
    where.sessions = {
      some: {
        modeFormation: filters.mode as any,
        statut: {
          in: [SessionProfessionalStatus.PLANIFIEE, SessionProfessionalStatus.OUVERTE],
        },
      },
    };
  }

  return where;
}

export async function getCatalogue(
  filters: CatalogueFilters
): Promise<CatalogueResponse> {
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 9;
  const where = buildWhere(filters);

  try {
    const [total, formations] = await Promise.all([
      prisma.formationProfessionnelle.count({ where }),
      prisma.formationProfessionnelle.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { titre: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          sessions: {
            where: {
              statut: {
                in: [SessionProfessionalStatus.PLANIFIEE, SessionProfessionalStatus.OUVERTE],
              },
            },
            orderBy: { dateDebut: "asc" },
            take: 1,
            include: {
              sessionFormateurs: {
                include: {
                  formateur: {
                    select: { nom: true, prenom: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      data: formations.map(mapFormationCard),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  } catch (error) {
    if (isMissingTableError(error)) {
      return {
        data: [],
        pagination: {
          page,
          pageSize,
          total: 0,
          totalPages: 1,
        },
      };
    }

    throw error;
  }
}

export async function getPopularFormations() {
  const { data } = await getCatalogue({ pageSize: 6 });
  return data.slice(0, 6);
}

export async function getFormationBySlug(slug: string) {
  let formation;
  try {
    formation = await prisma.formationProfessionnelle.findFirst({
      where: {
        slug,
        actif: true,
        ...(DEFAULT_TENANT_ID ? { tenantId: DEFAULT_TENANT_ID } : {}),
      },
      include: {
        sessions: {
          where: {
            statut: {
              in: [SessionProfessionalStatus.PLANIFIEE, SessionProfessionalStatus.OUVERTE],
            },
          },
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
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      return null;
    }

    throw error;
  }

  if (!formation) return null;

  const formateurs = mapTrainer(
    formation.sessions.flatMap((session) => session.sessionFormateurs)
  ).filter(
    (trainer, index, list) => list.findIndex((item) => item.id === trainer.id) === index
  );

  const card = mapFormationCard({
    ...formation,
    sessions: formation.sessions.map((session) => ({
      ...session,
      sessionFormateurs: session.sessionFormateurs.map(({ formateur }) => ({
        formateur: { nom: formateur.nom, prenom: formateur.prenom },
      })),
    })),
  });

  const detail: FormationDetailData = {
    ...card,
    descriptionComplete:
      formation.descriptionComplete ||
      formation.descriptionCourte ||
      "Formation professionnelle conçue pour un impact rapide et durable.",
    prerequis: formation.prerequis,
    publicCible: formation.publicCible,
    objectifs: toStringArray(formation.objectifs),
    modules: toModuleList(formation.programmeDetaille),
    formateurs,
    sessions: formation.sessions.map((session) => ({
      id: session.id,
      codeSession: session.codeSession || "Session à venir",
      dateDebut: session.dateDebut.toISOString(),
      dateFin: session.dateFin.toISOString(),
      mode: formatMode(session.modeFormation),
      lieu: session.lieu,
      prix: session.prixTtc ? Number(session.prixTtc) : null,
      placesRestantes: session.placesTotales - (session.placesReservees || 0),
    })),
    certification: formation.nomCertification || formation.typeCertification,
    brochurePdfUrl: formation.brochurePdfUrl,
  };

  return detail;
}

export async function getPurchasedFormations(userId: string, statut?: StatutInscription) {
  let rows;
  try {
    rows = await prisma.inscriptionPublic.findMany({
      where: {
        userId,
        ...(statut ? { statut } : {}),
      },
      orderBy: { dateInscription: "desc" },
      include: {
        formation: true,
        session: true,
      },
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      return [];
    }

    throw error;
  }

  return rows.map((item) => ({
    id: item.id,
    statut: item.statut,
    dateInscription: item.dateInscription.toISOString(),
    codePaiement: item.codePaiement,
    montantPaye: Number(item.montantPaye),
    formation: {
      id: item.formation.id,
      titre: item.formation.titre,
      slug: item.formation.slug || item.formation.id,
      descriptionCourte:
        item.formation.descriptionCourte || "Formation professionnelle certifiante.",
    },
    session: item.session
      ? {
          id: item.session.id,
          codeSession: item.session.codeSession,
          dateDebut: item.session.dateDebut.toISOString(),
        }
      : null,
  }));
}

export async function hasConfirmedEnrollment(userId: string, formationId: string) {
  let enrollment;
  try {
    enrollment = await prisma.inscriptionPublic.findFirst({
      where: {
        userId,
        formationId,
        statut: StatutInscription.CONFIRME,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      return false;
    }

    throw error;
  }

  return Boolean(enrollment);
}
