import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPlaceholderTrainerEmail, formatTenantLabel } from "@/lib/admin";
import { formatDate } from "@/lib/utils";

function isMissingTableError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2021"
  );
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

function buildSessionLabel(session: {
  codeSession: string | null;
  dateDebut: Date;
  modeFormation: string;
}) {
  return `${session.codeSession || "Session"} - ${formatDate(session.dateDebut)} - ${formatMode(session.modeFormation)}`;
}

export interface AdminTenantOption {
  id: string;
  label: string;
  supportCount: number;
  pendingCount: number;
  trainerCount: number;
}

export interface AdminFormateurOption {
  id: string;
  tenantId: string;
  label: string;
  email: string;
}

export interface AdminSessionOption {
  id: string;
  label: string;
}

export interface AdminSupportAssignmentItem {
  id: string;
  titre: string;
  tenantId: string;
  tenantLabel: string;
  formationId: string | null;
  formationTitre: string;
  currentFormateurId: string;
  currentFormateurLabel: string;
  currentFormateurEmail: string;
  currentSessionId: string | null;
  currentSessionLabel: string | null;
  isPlaceholder: boolean;
  needsSession: boolean;
  availableFormateurs: AdminFormateurOption[];
  availableSessions: AdminSessionOption[];
}

export interface AdminSupportAssignmentsData {
  tenants: AdminTenantOption[];
  supports: AdminSupportAssignmentItem[];
}

export async function getAdminSupportAssignments(): Promise<AdminSupportAssignmentsData> {
  try {
    const supports = await prisma.supportCours.findMany({
      where: {
        formationId: { not: null },
      },
      orderBy: [{ createdAt: "asc" }, { titre: "asc" }],
      include: {
        formation: {
          include: {
            sessions: {
              orderBy: { dateDebut: "asc" },
            },
          },
        },
        formateur: true,
        session: true,
      },
    });

    const supportsToReview = supports.filter(
      (support) =>
        isPlaceholderTrainerEmail(support.formateur.email) || !support.sessionId
    );

    const tenantIds = Array.from(new Set(supportsToReview.map((support) => support.tenantId)));
    const formateurs = tenantIds.length
      ? await prisma.formateur.findMany({
          where: {
            tenantId: { in: tenantIds },
          },
          orderBy: [{ prenom: "asc" }, { nom: "asc" }],
        })
      : [];

    const nonPlaceholderFormateurs = formateurs.filter(
      (formateur) => !isPlaceholderTrainerEmail(formateur.email)
    );

    const formateursByTenant = new Map(
      tenantIds.map((tenantId) => [
        tenantId,
        nonPlaceholderFormateurs
          .filter((formateur) => formateur.tenantId === tenantId)
          .map((formateur) => ({
            id: formateur.id,
            tenantId: formateur.tenantId,
            label: `${formateur.prenom} ${formateur.nom}`.trim(),
            email: formateur.email,
          })),
      ])
    );

    const tenants = tenantIds.map((tenantId) => {
      const tenantSupports = supportsToReview.filter((support) => support.tenantId === tenantId);

      return {
        id: tenantId,
        label: formatTenantLabel(tenantId),
        supportCount: tenantSupports.length,
        pendingCount: tenantSupports.filter(
          (support) =>
            isPlaceholderTrainerEmail(support.formateur.email) || !support.sessionId
        ).length,
        trainerCount: (formateursByTenant.get(tenantId) || []).length,
      };
    });

    return {
      tenants,
      supports: supportsToReview.map((support) => ({
        id: support.id,
        titre: support.titre,
        tenantId: support.tenantId,
        tenantLabel: formatTenantLabel(support.tenantId),
        formationId: support.formationId,
        formationTitre: support.formation?.titre || "Formation non rattachée",
        currentFormateurId: support.formateurId,
        currentFormateurLabel: `${support.formateur.prenom} ${support.formateur.nom}`.trim(),
        currentFormateurEmail: support.formateur.email,
        currentSessionId: support.sessionId,
        currentSessionLabel: support.session ? buildSessionLabel(support.session) : null,
        isPlaceholder: isPlaceholderTrainerEmail(support.formateur.email),
        needsSession: !support.sessionId,
        availableFormateurs: formateursByTenant.get(support.tenantId) || [],
        availableSessions: support.formation?.sessions.map((session) => ({
          id: session.id,
          label: buildSessionLabel(session),
        })) || [],
      })),
    };
  } catch (error) {
    if (isMissingTableError(error)) {
      return {
        tenants: [],
        supports: [],
      };
    }

    throw error;
  }
}
