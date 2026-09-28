import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import {
  OwnerFinancesQuerySchema,
  OwnerFinancesResponseSchema,
  OwnerFinancialReportQuerySchema,
  OwnerPayrollValidateResponseSchema,
  OwnerAcademicResponseSchema,
  OwnerStaffResponseSchema,
  OwnerFormationsResponseSchema,
  OwnerUsersListResponseSchema,
  OwnerAssignableRolesResponseSchema,
  OwnerUserRolesPatchBodySchema,
  OwnerUserRolesPatchResponseSchema,
} from "@ecoledigitale/contracts/src/owner.schema";
import {
  OwnerPedagogieQuerySchema,
  OwnerPedagogieResponseSchema,
  OwnerFinancesProQuerySchema,
  OwnerFinancesProResponseSchema,
  OwnerStatsFiltersResponseSchema,
  OwnerReferentielQuerySchema,
  OwnerReferentielResponseSchema,
  OwnerAssiduiteQuerySchema,
  OwnerAssiduiteResponseSchema,
  OwnerPersonnesQuerySchema,
  OwnerPersonnesResponseSchema,
  OwnerRecrutementQuerySchema,
  OwnerRecrutementResponseSchema,
  OwnerProspectionQuerySchema,
  OwnerProspectionResponseSchema,
  OwnerPulseQuerySchema,
  OwnerPulseResponseSchema,
  OwnerTresorerieQuerySchema,
  OwnerTresorerieResponseSchema,
  OwnerCashRegisterQuerySchema,
  OwnerCashRegisterResponseSchema,
  OwnerRemplissageQuerySchema,
  OwnerRemplissageResponseSchema,
  OwnerRisqueQuerySchema,
  OwnerRisqueResponseSchema,
  OwnerEconomieQuerySchema,
  OwnerEconomieResponseSchema,
  OwnerPayrollQuerySchema,
  OwnerPayrollResponseSchema,
} from "@ecoledigitale/contracts/src/owner-stats.schema";
import {
  OwnerChargesQuerySchema,
  OwnerChargesResponseSchema,
  OwnerChargeCategoriesResponseSchema,
  OwnerChargeCreateBodySchema,
  OwnerChargePatchBodySchema,
  OwnerChargeMutationResponseSchema,
  OwnerChargeCohortesResponseSchema,
} from "@ecoledigitale/contracts/src/owner-charges.schema";
import {
  OwnerScolariteQuerySchema,
  OwnerScolariteResponseSchema,
} from "@ecoledigitale/contracts/src/owner-scolarite.schema";
import {
  OwnerDocumentsQuerySchema,
  OwnerDocumentsResponseSchema,
} from "@ecoledigitale/contracts/src/owner-documents.schema";
import {
  OwnerProgrammeQuerySchema,
  OwnerProgrammeResponseSchema,
} from "@ecoledigitale/contracts/src/owner-programme.schema";
import {
  fetchOwnerCharges,
  fetchOwnerChargeCategories,
  createOwnerCharge,
  updateOwnerCharge,
  deleteOwnerCharge,
  OwnerChargeInvalide,
  fetchOwnerChargeCohortes,
} from "../../services/owner-charges.service";
import {
  buildOwnerEconomieCsv,
  fetchOwnerEconomie,
} from "../../services/owner-economie.service";
import {
  buildOwnerRisqueCsv,
  fetchOwnerRisque,
} from "../../services/owner-risque.service";
import {
  buildOwnerScolariteCsv,
  fetchOwnerScolarite,
} from "../../services/owner-scolarite.service";
import {
  buildOwnerDocumentsCsv,
  fetchOwnerDocuments,
} from "../../services/owner-documents.service";
import {
  buildOwnerProgrammeCsv,
  fetchOwnerProgramme,
} from "../../services/owner-programme.service";
import {
  buildOwnerRemplissageCsv,
  fetchOwnerRemplissage,
} from "../../services/owner-remplissage.service";
import { fetchOwnerPulse } from "../../services/owner-pulse.service";
import { fetchOwnerPayrollMass } from "../../services/owner-payroll-mass.service";
import {
  buildOwnerCashRegisterCsv,
  fetchOwnerCashRegister,
  fetchOwnerTresorerie,
} from "../../services/owner-tresorerie.service";
import { fetchOwnerReferentiel } from "../../services/owner-referentiel.service";
import { fetchOwnerAssiduite } from "../../services/owner-assiduite.service";
import { fetchOwnerPersonnes } from "../../services/owner-personnes.service";
import { fetchOwnerRecrutement } from "../../services/owner-recrutement.service";
import { fetchOwnerProspection } from "../../services/owner-prospection.service";
import {
  buildOwnerAssiduiteCsv,
  buildOwnerFinancesProCsv,
  buildOwnerPedagogieCsv,
  buildOwnerPersonnesCsv,
  buildOwnerPayrollCsv,
  buildOwnerRecrutementCsv,
  buildOwnerProspectionCsv,
} from "../../services/owner-stats-csv.service";
import { requireOwner, requireOwnerOrAdmin } from "../../middlewares/requireOwner";
import { fetchOwnerPedagogie } from "../../services/owner-pedagogie.service";
import { fetchOwnerFinancesPro } from "../../services/owner-finances-pro.service";
import { fetchOwnerStatsFilters } from "../../services/owner-stats-filters.service";
import {
  buildOwnerFinancialReportCsv,
  buildOwnerFinancialReportHtml,
  fetchOwnerFinances,
  type OwnerFinancesQuery,
} from "../../services/owner-finances.service";
import { PDFGenerationService } from "../../services/pdf-generation.service";
import { validateTeacherPaymentAsOwner } from "../../services/owner-payroll.service";
import { fetchOwnerAcademic } from "../../services/owner-academic.service";
import { fetchOwnerStaff } from "../../services/owner-staff.service";
import { fetchOwnerFormations } from "../../services/owner-formations.service";
import {
  OWNER_ASSIGNABLE_ROLE_KEYS,
  listOwnerTenantUsers,
  patchUserRolesAsOwner,
} from "../../services/owner-users.service";

/**
 * Normalise la query string des routes de statistiques avant validation Zod.
 *
 * Fastify parse `?filiereIds=a&filiereIds=b` en tableau mais `?filiereIds=a` en
 * chaîne : sans ce passage, un filtre à une seule filière échouerait la validation
 * `z.array(...)`. On accepte aussi la forme CSV `?filiereIds=a,b`, plus commode à
 * construire côté front.
 */
function normalizeStatsQuery(q: unknown): Record<string, unknown> {
  const src = (q ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };

  for (const key of ["filiereIds"]) {
    const raw = src[key];
    if (raw === undefined || raw === null || raw === "") {
      delete out[key];
      continue;
    }
    const list = Array.isArray(raw) ? raw : String(raw).split(",");
    const cleaned = list.map((v) => String(v).trim()).filter((v) => v.length > 0);
    if (cleaned.length === 0) delete out[key];
    else out[key] = cleaned;
  }


  /*
     Les filtres texte sont rognés avant d'être comparés.

     nomClasse porte la clé « filiereId|nom » : elle traverse une URL, un
     champ de recherche et parfois un copier-coller, et une espace en tête ou
     en queue la rend introuvable en base. L'égalité SQL est stricte, elle ne
     pardonne pas — le filtre ne ramènerait rien, et l'écran vide se lirait
     comme une absence de données plutôt que comme une clé mal formée.

     La boucle « chaîne vide » ci-dessous vient après, pour qu'un filtre
     réduit à des espaces soit traité comme un filtre absent.
  */
  for (const key of ["nomClasse", "recherche", "search"]) {
    if (typeof out[key] === "string") out[key] = (out[key] as string).trim();
  }
  // Une chaîne vide vaut « filtre absent », pas « valeur invalide ».
  for (const key of Object.keys(out)) {
    if (out[key] === "") delete out[key];
  }

  return out;
}

function parseOwnerFinancesQuery(q: unknown): OwnerFinancesQuery {
  const parsed = OwnerFinancesQuerySchema.safeParse(normalizeStatsQuery(q));
  const d = parsed.success ? parsed.data : { period: "month" as const };
  return {
    period: d.period ?? "month",
    anneeScolaire: d.anneeScolaire,
    filiereIds: d.filiereIds,
    // Le périmètre complet : sans ces deux lignes, le service recevrait un
    // filtre que l écran a pourtant envoyé, et ne filtrerait rien.
    nomClasse: "nomClasse" in d ? d.nomClasse : undefined,
    semestreId: "semestreId" in d ? d.semestreId : undefined,
  };
}



export async function ownerRoutes(fastify: FastifyInstance) {
  /**
   * Le « pouls » : les 8 indicateurs de tête, consolidés scolaire + professionnel.
   * Lecture pure, sans effet de bord. `computedAt` permet à l'écran d'afficher
   * « données au JJ/MM à HH:MM » plutôt que de laisser croire au temps réel.
   */
  fastify.get(
    "/pulse",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const parsed = OwnerPulseQuerySchema.safeParse(normalizeStatsQuery(request.query));
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Paramètres de filtrage invalides",
        });
      }
      try {
        const data = await fetchOwnerPulse(
          fastify.pg as Pool,
          tenantId,
          request.log,
          parsed.data.anneeScolaire
        );
        reply.send(OwnerPulseResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner pulse aggregation failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Calcul du pouls impossible",
        });
      }
    }
  );

  /**
   * Économie : marge brute pédagogique par filière, LTV par famille, rétention
   * inter-semestres, prévision de trésorerie à 13 semaines.
   */
  fastify.get(
    "/economie",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const raw = normalizeStatsQuery(request.query) as Record<string, unknown>;
      const wantsCsv = String(raw.format ?? "").toLowerCase() === "csv";
      const parsed = OwnerEconomieQuerySchema.safeParse(raw);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Paramètres de filtrage invalides",
        });
      }
      try {
        const data = await fetchOwnerEconomie(
          fastify.pg as Pool,
          tenantId,
          parsed.data,
          request.log
        );
        if (!wantsCsv) {
          return reply.send(OwnerEconomieResponseSchema.parse(data));
        }
        reply
          .header("Content-Type", "text/csv; charset=utf-8")
          .header("Content-Disposition", `attachment; filename="economie.csv"`)
          // BOM : sans lui Excel lit le CSV en ANSI et casse les accents.
          .send("﻿" + buildOwnerEconomieCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner economie aggregation failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Calcul économique impossible",
        });
      }
    }
  );

  /**
   * Qualité et risque : score de décrochage, avancement de saisie par
   * enseignant nommé, corrélation assiduité / résultats.
   *
   * `?format=csv` exporte la liste nominative des étudiants à rappeler — c'est
   * la seule sortie de tout l'espace propriétaire qui se traduit directement en
   * coups de téléphone.
   */
  fastify.get(
    "/risque",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const raw = normalizeStatsQuery(request.query) as Record<string, unknown>;
      const wantsCsv = String(raw.format ?? "").toLowerCase() === "csv";
      const parsed = OwnerRisqueQuerySchema.safeParse(raw);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Paramètres de filtrage invalides",
        });
      }
      try {
        const data = await fetchOwnerRisque(
          fastify.pg as Pool,
          tenantId,
          parsed.data,
          request.log
        );
        if (!wantsCsv) {
          return reply.send(OwnerRisqueResponseSchema.parse(data));
        }
        reply
          .header("Content-Type", "text/csv; charset=utf-8")
          .header("Content-Disposition", `attachment; filename="etudiants-a-risque.csv"`)
          // BOM : sans lui Excel lit le CSV en ANSI et casse les accents.
          .send("﻿" + buildOwnerRisqueCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner risque aggregation failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Calcul du risque impossible",
        });
      }
    }
  );

  /**
   * Programme : une ligne par UE, le produit et la brique pédagogique côte à
   * côte — prix, crédits affichés, crédits réellement calculés, ouvertures,
   * inscrits.
   *
   * L'écart de maquette est le point dur : `nb_uv` est AFFICHÉ, la somme des
   * crédits des ECUE est ce qui s'IMPRIME sur les relevés et les diplômes. Quand
   * les deux divergent, le document officiel porte un faux — à corriger avant de
   * générer les bulletins, sinon il faut réimprimer.
   *
   * Le volume horaire sort `mesurable: false` tant que le planning n'est pas
   * saisi : un rapport heures/crédits bâti sur trois séances ferait passer une
   * absence de planning pour une sous-dotation.
   */
  fastify.get(
    "/programme",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const raw = normalizeStatsQuery(request.query) as Record<string, unknown>;
      const wantsCsv = String(raw.format ?? "").toLowerCase() === "csv";
      const parsed = OwnerProgrammeQuerySchema.safeParse(raw);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Paramètres de filtrage invalides",
        });
      }
      try {
        const data = await fetchOwnerProgramme(
          fastify.pg as Pool,
          tenantId,
          parsed.data,
          request.log
        );
        if (!wantsCsv) {
          return reply.send(OwnerProgrammeResponseSchema.parse(data));
        }
        reply
          .header("Content-Type", "text/csv; charset=utf-8")
          .header("Content-Disposition", `attachment; filename="programme.csv"`)
          // BOM : sans lui Excel lit le CSV en ANSI et casse les accents.
          .send("\ufeff" + buildOwnerProgrammeCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner programme aggregation failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Calcul du programme impossible",
        });
      }
    }
  );

  /**
   * Documents officiels : pipeline de diplomation, signataires, complétude des
   * dossiers.
   *
   * Deux faits que rien ne montrait : l'éligible non diplômé (un dossier fini
   * qui dort) et l'octroi sans les UV requises (un titre attaquable). Plus
   * l'état des signataires — les quatre valeurs livrées par défaut sont des
   * noms de personnes réelles, et un établissement qui ne les a pas remplacés
   * imprime leur signature sur ses diplômes.
   *
   * Le volume d'attestations est déclaré NON MESURABLE : aucune table ne les
   * enregistre.
   */
  fastify.get(
    "/documents",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const raw = normalizeStatsQuery(request.query) as Record<string, unknown>;
      const wantsCsv = String(raw.format ?? "").toLowerCase() === "csv";
      const parsed = OwnerDocumentsQuerySchema.safeParse(raw);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Paramètres de filtrage invalides",
        });
      }
      try {
        const data = await fetchOwnerDocuments(
          fastify.pg as Pool,
          tenantId,
          parsed.data,
          request.log
        );
        if (!wantsCsv) {
          return reply.send(OwnerDocumentsResponseSchema.parse(data));
        }
        reply
          .header("Content-Type", "text/csv; charset=utf-8")
          .header("Content-Disposition", `attachment; filename="documents-officiels.csv"`)
          // BOM : sans lui Excel lit le CSV en ANSI et casse les accents.
          .send("\ufeff" + buildOwnerDocumentsCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner documents aggregation failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Calcul des documents officiels impossible",
        });
      }
    }
  );

  /**
   * Scolarité : le barème de chaque classe, ce qui a réellement été commandé,
   * et l'écart entre les deux.
   *
   * L'unité est le LOT (étudiant × classe), la seule qui porte une dette. Une
   * classe sans grille tarifaire ne produit aucun dû — jamais zéro : la
   * réponse porte `couverture.duInterpretable` pour que l'écran dise
   * « commandé » tant que le dû n'est pas mesurable.
   *
   * `?format=csv` exporte la ventilation par classe, en-tête de périmètre
   * compris.
   */
  fastify.get(
    "/scolarite",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const raw = normalizeStatsQuery(request.query) as Record<string, unknown>;
      const wantsCsv = String(raw.format ?? "").toLowerCase() === "csv";
      const parsed = OwnerScolariteQuerySchema.safeParse(raw);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Paramètres de filtrage invalides",
        });
      }
      try {
        const data = await fetchOwnerScolarite(
          fastify.pg as Pool,
          tenantId,
          parsed.data,
          request.log
        );
        if (!wantsCsv) {
          return reply.send(OwnerScolariteResponseSchema.parse(data));
        }
        reply
          .header("Content-Type", "text/csv; charset=utf-8")
          .header("Content-Disposition", `attachment; filename="scolarite-bareme.csv"`)
          // BOM : sans lui Excel lit le CSV en ANSI et casse les accents.
          .send("\ufeff" + buildOwnerScolariteCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner scolarite aggregation failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Calcul de la scolarité impossible",
        });
      }
    }
  );

  /**
   * Remplissage et planning. `?format=csv` exporte cohortes, classes et
   * conflits — ce qu'un directeur des études emporte en réunion de rentrée.
   */
  fastify.get(
    "/remplissage",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const raw = normalizeStatsQuery(request.query) as Record<string, unknown>;
      const wantsCsv = String(raw.format ?? "").toLowerCase() === "csv";
      const parsed = OwnerRemplissageQuerySchema.safeParse(raw);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Paramètres de filtrage invalides",
        });
      }
      try {
        const data = await fetchOwnerRemplissage(
          fastify.pg as Pool,
          tenantId,
          parsed.data,
          request.log
        );
        if (!wantsCsv) {
          return reply.send(OwnerRemplissageResponseSchema.parse(data));
        }
        reply
          .header("Content-Type", "text/csv; charset=utf-8")
          .header("Content-Disposition", `attachment; filename="remplissage.csv"`)
          // BOM : sans lui Excel lit le CSV en ANSI et casse les accents.
          .send("﻿" + buildOwnerRemplissageCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner remplissage aggregation failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Calcul du remplissage impossible",
        });
      }
    }
  );

  /**
   * Trésorerie et recouvrement : balance âgée, courbe d'encaissements comparée
   * à la même saison l'an dernier, répartition par mode, écarts de caisse.
   */
  fastify.get(
    "/tresorerie",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const parsed = OwnerTresorerieQuerySchema.safeParse(normalizeStatsQuery(request.query));
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Paramètres de période invalides",
        });
      }
      try {
        const data = await fetchOwnerTresorerie(
          fastify.pg as Pool,
          tenantId,
          parsed.data,
          request.log
        );
        reply.send(OwnerTresorerieResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner tresorerie aggregation failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Calcul de la trésorerie impossible",
        });
      }
    }
  );

  /**
   * Journal de caisse. `?format=csv` renvoie la pièce comptable complète sur la
   * période — pas la page affichée à l'écran, sinon l'export mentirait.
   */
  fastify.get(
    "/tresorerie/journal",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const raw = normalizeStatsQuery(request.query) as Record<string, unknown>;
      const wantsCsv = String(raw.format ?? "").toLowerCase() === "csv";
      const parsed = OwnerCashRegisterQuerySchema.safeParse(raw);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Paramètres du journal de caisse invalides",
        });
      }
      try {
        const input = wantsCsv
          ? { ...parsed.data, page: 1, pageSize: 500 }
          : parsed.data;
        const data = await fetchOwnerCashRegister(
          fastify.pg as Pool,
          tenantId,
          input,
          request.log
        );

        if (!wantsCsv) {
          return reply.send(OwnerCashRegisterResponseSchema.parse(data));
        }

        // Au-delà d'une page serveur, on parcourt le reste pour que le fichier
        // soit exhaustif : un journal de caisse tronqué n'a aucune valeur.
        let all = data;
        if (data.totalCount > data.rows.length) {
          const rows = [...data.rows];
          const pages = Math.ceil(data.totalCount / 500);
          for (let p = 2; p <= pages; p++) {
            const next = await fetchOwnerCashRegister(
              fastify.pg as Pool,
              tenantId,
              { ...parsed.data, page: p, pageSize: 500 },
              request.log
            );
            rows.push(...next.rows);
          }
          all = { ...data, rows };
        }

        const csv = buildOwnerCashRegisterCsv(all);
        reply
          .header("Content-Type", "text/csv; charset=utf-8")
          .header(
            "Content-Disposition",
            `attachment; filename="journal-de-caisse-${all.dateDebut}_${all.dateFin}.csv"`
          )
          // BOM : sans lui Excel lit le CSV en ANSI et casse les accents.
          .send("﻿" + csv);
      } catch (e) {
        request.log.error({ err: e }, "owner cash register failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Journal de caisse indisponible",
        });
      }
    }
  );

  fastify.get(
    "/finances",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const input = parseOwnerFinancesQuery(request.query);
      try {
        const data = await fetchOwnerFinances(
          fastify.pg as Pool,
          tenantId,
          input,
          request.log
        );
        reply.send(OwnerFinancesResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner finances failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les données financières",
        });
      }
    }
  );

  fastify.get(
    "/academic",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerAcademic(fastify.pg as Pool, tenantId, request.log);
        reply.send(OwnerAcademicResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner academic failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les synthèses académiques",
        });
      }
    }
  );

  /* ---------------- Statistiques Module Professionnel (LMD) ---------------- */

  /**
   * Référentiel des filtres (filières, semestres, années scolaires).
   * `requireOwnerOrAdmin` : purement descriptif, utile aussi aux admins.
   */
  fastify.get(
    "/stats/filters",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerStatsFilters(fastify.pg as Pool, tenantId, request.log);
        reply.send(OwnerStatsFiltersResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner stats filters failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les filtres",
        });
      }
    }
  );

  /**
   * Pilotage pédagogique LMD.
   * `requireOwnerOrAdmin` : la performance académique est un outil de pilotage
   * pédagogique dont les admins ont aussi l'usage (§8-3).
   */
  fastify.get(
    "/pedagogie",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const parsed = OwnerPedagogieQuerySchema.safeParse(
        normalizeStatsQuery(request.query)
      );
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerPedagogie(
          fastify.pg as Pool,
          tenantId,
          request.log,
          parsed.data
        );
        reply.send(OwnerPedagogieResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner pedagogie failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger le pilotage pédagogique",
        });
      }
    }
  );

  /**
   * Recouvrement du module professionnel.
   * `requireOwner` strict : vue financière consolidée réservée au propriétaire (§8-3).
   */
  fastify.get(
    "/finances/professionnel",
    { preHandler: requireOwner },
    async (request, reply) => {
      const parsed = OwnerFinancesProQuerySchema.safeParse(
        normalizeStatsQuery(request.query)
      );
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerFinancesPro(
          fastify.pg as Pool,
          tenantId,
          request.log,
          parsed.data
        );
        reply.send(OwnerFinancesProResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner finances pro failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger le recouvrement du module professionnel",
        });
      }
    }
  );

  /**
   * Santé du catalogue et incohérences structurelles.
   * `requireOwnerOrAdmin` : ce sont les admins qui corrigeront les anomalies (§8-3).
   */
  fastify.get(
    "/referentiel",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const parsed = OwnerReferentielQuerySchema.safeParse(
        normalizeStatsQuery(request.query)
      );
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerReferentiel(
          fastify.pg as Pool,
          tenantId,
          request.log,
          parsed.data
        );
        reply.send(OwnerReferentielResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner referentiel failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger la santé du référentiel",
        });
      }
    }
  );

  /**
   * Assiduité, occupation des salles et charge enseignante.
   * `requireOwnerOrAdmin` : exploitation opérationnelle, utile aux admins (§8-3).
   */
  fastify.get(
    "/assiduite",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const parsed = OwnerAssiduiteQuerySchema.safeParse(
        normalizeStatsQuery(request.query)
      );
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerAssiduite(
          fastify.pg as Pool,
          tenantId,
          request.log,
          parsed.data
        );
        reply.send(OwnerAssiduiteResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner assiduite failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les données d'assiduité",
        });
      }
    }
  );

  /**
   * Démographie et état des comptes.
   * `requireOwner` strict : données personnelles agrégées de toute la population.
   */
  fastify.get(
    "/personnes",
    { preHandler: requireOwner },
    async (request, reply) => {
      const parsed = OwnerPersonnesQuerySchema.safeParse(
        normalizeStatsQuery(request.query)
      );
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerPersonnes(
          fastify.pg as Pool,
          tenantId,
          request.log,
          parsed.data
        );
        reply.send(OwnerPersonnesResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner personnes failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger la démographie",
        });
      }
    }
  );

  /**
   * Entonnoir des inscriptions en ligne.
   * `requireOwnerOrAdmin` : ce sont les admins qui traitent les demandes (§8-3).
   */
  fastify.get(
    "/recrutement",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const parsed = OwnerRecrutementQuerySchema.safeParse(
        normalizeStatsQuery(request.query)
      );
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerRecrutement(
          fastify.pg as Pool,
          tenantId,
          request.log,
          parsed.data
        );
        reply.send(OwnerRecrutementResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner recrutement failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les données de recrutement",
        });
      }
    }
  );

  /**
   * Prospection — provenance des étudiants et coût des commerciaux.
   *
   * `requireOwner` strict : on y lit une dette envers des tiers et le prix payé
   * pour chaque étudiant recruté (§8-3). L'administration a ses propres écrans
   * d'exploitation sous `/api/v1/prospection`, qui ne consolident rien.
   */
  fastify.get(
    "/prospection",
    { preHandler: requireOwner },
    async (request, reply) => {
      const parsed = OwnerProspectionQuerySchema.safeParse(
        normalizeStatsQuery(request.query)
      );
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerProspection(
          fastify.pg as Pool,
          tenantId,
          request.log,
          parsed.data
        );
        reply.send(OwnerProspectionResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner prospection failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les données de prospection",
        });
      }
    }
  );

  /* ------------------- Exports CSV des pages de statistiques ------------------ */

  /**
   * Chaque export reprend la garde de sa page : un admin qui n'a pas accès aux
   * finances consolidées ne doit pas pouvoir les récupérer par l'export.
   *
   * Le BOM `﻿` est indispensable pour qu'Excel en configuration française
   * affiche correctement les accents.
   */
  function sendCsv(reply: FastifyReply, filename: string, csv: string) {
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    // ⚠️ Le littéral ci-dessous est un vrai caractère BOM (U+FEFF), invisible à
    // la relecture. Ailleurs dans ce fichier la convention est la séquence
    // d'échappement "﻿" (cf. /reports/financial) — les octets produits sont
    // identiques. Ne pas supprimer ce caractère en croyant à une coquille : sans
    // lui, Excel en configuration française n'affiche pas les accents.
    return reply.send("﻿" + csv);
  }

  fastify.get(
    "/pedagogie/export",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const parsed = OwnerPedagogieQuerySchema.safeParse(normalizeStatsQuery(request.query));
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const data = await fetchOwnerPedagogie(
          fastify.pg as Pool,
          request.tenantId!,
          request.log,
          parsed.data
        );
        return sendCsv(reply, "pilotage-pedagogique.csv", buildOwnerPedagogieCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner pedagogie export failed");
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de générer l'export",
        });
      }
    }
  );

  fastify.get(
    "/finances/professionnel/export",
    { preHandler: requireOwner },
    async (request, reply) => {
      const parsed = OwnerFinancesProQuerySchema.safeParse(normalizeStatsQuery(request.query));
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const data = await fetchOwnerFinancesPro(
          fastify.pg as Pool,
          request.tenantId!,
          request.log,
          parsed.data
        );
        return sendCsv(
          reply,
          "recouvrement-professionnel.csv",
          buildOwnerFinancesProCsv(data)
        );
      } catch (e) {
        request.log.error({ err: e }, "owner finances pro export failed");
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de générer l'export",
        });
      }
    }
  );

  fastify.get(
    "/assiduite/export",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const parsed = OwnerAssiduiteQuerySchema.safeParse(normalizeStatsQuery(request.query));
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const data = await fetchOwnerAssiduite(
          fastify.pg as Pool,
          request.tenantId!,
          request.log,
          parsed.data
        );
        return sendCsv(reply, "assiduite.csv", buildOwnerAssiduiteCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner assiduite export failed");
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de générer l'export",
        });
      }
    }
  );

  fastify.get(
    "/personnes/export",
    { preHandler: requireOwner },
    async (request, reply) => {
      const parsed = OwnerPersonnesQuerySchema.safeParse(normalizeStatsQuery(request.query));
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const data = await fetchOwnerPersonnes(
          fastify.pg as Pool,
          request.tenantId!,
          request.log,
          parsed.data
        );
        return sendCsv(reply, "personnes.csv", buildOwnerPersonnesCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner personnes export failed");
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de générer l'export",
        });
      }
    }
  );

  fastify.get(
    "/recrutement/export",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const parsed = OwnerRecrutementQuerySchema.safeParse(normalizeStatsQuery(request.query));
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const data = await fetchOwnerRecrutement(
          fastify.pg as Pool,
          request.tenantId!,
          request.log,
          parsed.data
        );
        return sendCsv(reply, "recrutement.csv", buildOwnerRecrutementCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner recrutement export failed");
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de générer l'export",
        });
      }
    }
  );

  fastify.get(
    "/prospection/export",
    { preHandler: requireOwner },
    async (request, reply) => {
      const parsed = OwnerProspectionQuerySchema.safeParse(normalizeStatsQuery(request.query));
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const data = await fetchOwnerProspection(
          fastify.pg as Pool,
          request.tenantId!,
          request.log,
          parsed.data
        );
        return sendCsv(reply, "prospection.csv", buildOwnerProspectionCsv(data));
      } catch (e) {
        request.log.error({ err: e }, "owner prospection export failed");
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de générer l'export",
        });
      }
    }
  );

  /**
   * Masse salariale enseignante.
   *
   * `?format=csv` renvoie le même périmètre en tableur, filtres compris. Les
   * filtres portent sur la PÉRIODE DE PAIE et non sur l'année scolaire :
   * `payment_periods.academic_year_id` n'est renseignée nulle part, et un
   * filtre adossé à cette colonne renverrait un écran vide sans l'expliquer.
   */
  fastify.get(
    "/payroll",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const raw = normalizeStatsQuery(request.query) as Record<string, unknown>;
      const wantsCsv = String(raw.format ?? "").toLowerCase() === "csv";
      const parsed = OwnerPayrollQuerySchema.safeParse(raw);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Paramètres de filtrage invalides",
        });
      }
      try {
        const data = await fetchOwnerPayrollMass(
          fastify.pg as Pool,
          tenantId,
          parsed.data,
          request.log
        );
        if (wantsCsv) {
          return sendCsv(reply, "masse-salariale.csv", buildOwnerPayrollCsv(data));
        }
        reply.send(OwnerPayrollResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner payroll mass failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger la masse salariale",
        });
      }
    }
  );

  fastify.get(
    "/staff",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerStaff(fastify.pg as Pool, tenantId, request.log);
        reply.send(OwnerStaffResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner staff failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les données RH",
        });
      }
    }
  );

  fastify.get(
    "/formations",
    { preHandler: requireOwner },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      try {
        const data = await fetchOwnerFormations(fastify.pg as Pool, tenantId, request.log);
        reply.send(OwnerFormationsResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner formations failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de charger les formations professionnelles",
        });
      }
    }
  );

  fastify.get(
    "/roles/assignable",
    { preHandler: requireOwnerOrAdmin },
    async (_request, reply) => {
      reply.send(
        OwnerAssignableRolesResponseSchema.parse({
          roleKeys: [...OWNER_ASSIGNABLE_ROLE_KEYS],
        })
      );
    }
  );

  fastify.get(
    "/users",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const tenantId = request.tenantId!;
      const users = await listOwnerTenantUsers(fastify.pg as Pool, tenantId, request.log);
      reply.send(OwnerUsersListResponseSchema.parse({ users }));
    }
  );

  fastify.patch<{ Params: { userId: string } }>(
    "/users/:userId/roles",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      const { userId: targetUserId } = request.params;
      if (!z.string().uuid().safeParse(targetUserId).success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Identifiant utilisateur invalide",
        });
      }

      const parsed = OwnerUserRolesPatchBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }

      const tenantId = request.tenantId!;
      const result = await patchUserRolesAsOwner(
        fastify.pg as Pool,
        tenantId,
        targetUserId,
        parsed.data.roleKeys,
        request.log
      );

      if (!result.ok) {
        return reply.status(result.status).send({
          success: false,
          error: result.status === 409 ? "Conflict" : result.status === 404 ? "Not Found" : "Bad Request",
          message: result.message,
        });
      }

      reply.send(OwnerUserRolesPatchResponseSchema.parse(result.body));
    }
  );

  fastify.get(
    "/reports/financial",
    { preHandler: requireOwner },
    async (request, reply) => {
      const parsed = OwnerFinancialReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.flatten().fieldErrors,
        });
      }
      const { format, ...rest } = parsed.data;
      const input = parseOwnerFinancesQuery(rest);
      const tenantId = request.tenantId!;
      let data;
      try {
        data = await fetchOwnerFinances(fastify.pg as Pool, tenantId, input, request.log);
      } catch (e) {
        request.log.error({ err: e }, "owner financial report failed");
        return reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Impossible de générer le rapport",
        });
      }

      if (format === "csv") {
        const csv = buildOwnerFinancialReportCsv(data);
        const filename = `rapport-financier-${input.period}.csv`;
        reply.header("Content-Type", "text/csv; charset=utf-8");
        reply.header("Content-Disposition", `attachment; filename="${filename}"`);
        return reply.send("\ufeff" + csv);
      }

      const html = buildOwnerFinancialReportHtml(data);
      const pdfService = new PDFGenerationService();
      try {
        const buf = await pdfService.generatePdfFromHtml(html);
        const filename = `rapport-financier-${input.period}.pdf`;
        reply.header("Content-Type", "application/pdf");
        reply.header("Content-Disposition", `attachment; filename="${filename}"`);
        return reply.send(buf);
      } catch (e) {
        request.log.error({ err: e }, "owner financial PDF failed");
        return reply.status(503).send({
          success: false,
          error: "Service Unavailable",
          message:
            e instanceof Error ? e.message : "Génération PDF indisponible (navigateur / Chrome requis)",
        });
      } finally {
        await pdfService.close().catch(() => {});
      }
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    "/payroll/:id/validate",
    { preHandler: requireOwner },
    async (request, reply) => {
      const { id } = request.params;
      if (!z.string().uuid().safeParse(id).success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: "Identifiant de paiement invalide",
        });
      }

      const tenantId = request.tenantId!;
      const userId = (request as { user?: { id: string } }).user?.id;
      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: "Unauthorized",
          message: "Utilisateur non authentifié",
        });
      }

      try {
        const result = await validateTeacherPaymentAsOwner(
          fastify.pg as Pool,
          tenantId,
          id,
          userId,
          request.log
        );

        if (!result.ok) {
          if (result.reason === "not_found") {
            return reply.status(404).send({
              success: false,
              error: "Not Found",
              message: "Paiement introuvable pour ce tenant",
            });
          }
          return reply.status(409).send({
            success: false,
            error: "Conflict",
            message:
              "Validation impossible : le paiement doit être au statut « calculé » et ne pas déjà être approuvé.",
          });
        }

        reply.send(OwnerPayrollValidateResponseSchema.parse(result.payment));
      } catch (e) {
        request.log.error({ err: e, id }, "owner payroll validate failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Erreur lors de la validation du paiement",
        });
      }
    }
  );

  /* ---------------------------------------------------------------------- */
  /*  Charges — les seules routes d'ÉCRITURE métier de l'espace propriétaire */
  /* ---------------------------------------------------------------------- */

  /*
     Pourquoi l'espace propriétaire écrit ici, et nulle part ailleurs.

     La table `expenses` existe depuis la migration 0098 et `owner-economie`
     la lit depuis toujours, mais aucune route ne permettait d'y saisir quoi que
     ce soit : l'écran Rentabilité ne pouvait afficher qu'un chiffre d'affaires
     et refusait, à juste titre, d'appeler « marge » un encaissement dont on
     n'avait retranché aucune charge. Ces cinq routes sont ce qui lui permet de
     l'écrire un jour.

     `requireOwner` strict : une charge est une écriture comptable, elle
     n'appartient pas au périmètre d'un administrateur de scolarité.
  */
  fastify.get("/charges", { preHandler: requireOwner }, async (request, reply) => {
    const tenantId = request.tenantId!;
    const parsed = OwnerChargesQuerySchema.safeParse(normalizeStatsQuery(request.query));
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: "Bad Request",
        message: "Paramètres de filtre invalides",
      });
    }
    try {
      const data = await fetchOwnerCharges(
        fastify.pg as Pool,
        tenantId,
        parsed.data,
        request.log
      );
      reply.send(OwnerChargesResponseSchema.parse(data));
    } catch (e) {
      request.log.error({ err: e }, "owner charges failed");
      reply.status(500).send({
        success: false,
        error: "Internal Server Error",
        message: "Erreur lors du chargement des charges",
      });
    }
  });

  fastify.get("/charges/categories", { preHandler: requireOwner }, async (request, reply) => {
    try {
      const data = await fetchOwnerChargeCategories(fastify.pg as Pool, request.tenantId!);
      reply.send(OwnerChargeCategoriesResponseSchema.parse(data));
    } catch (e) {
      request.log.error({ err: e }, "owner charge categories failed");
      reply.status(500).send({
        success: false,
        error: "Internal Server Error",
        message: "Erreur lors du chargement des catégories",
      });
    }
  });

  /*
     Les cohortes d une classe donnee. Le selecteur du formulaire en depend :
     sans elle, il proposerait des noms derives des ouvertures, que la cle
     etrangere de la charge refuserait ensuite.
  */
  fastify.get<{ Querystring: { programmeId?: string } }>(
    "/charges/cohortes",
    { preHandler: requireOwner },
    async (request, reply) => {
      try {
        const data = await fetchOwnerChargeCohortes(
          fastify.pg as Pool,
          request.tenantId!,
          request.query.programmeId ?? null
        );
        reply.send(OwnerChargeCohortesResponseSchema.parse(data));
      } catch (e) {
        request.log.error({ err: e }, "owner charge cohortes failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Erreur lors du chargement des cohortes",
        });
      }
    }
  );

  fastify.post("/charges", { preHandler: requireOwner }, async (request, reply) => {
    const parsed = OwnerChargeCreateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      // Le premier message de Zod, pas la liste entière : il est déjà rédigé
      // pour être lu par un comptable, pas par un développeur.
      return reply.status(400).send({
        success: false,
        error: "Bad Request",
        message: parsed.error.issues[0]?.message ?? "Charge invalide",
      });
    }
    try {
      const charge = await createOwnerCharge(
        fastify.pg as Pool,
        request.tenantId!,
        parsed.data,
        request.user?.id ?? null,
        request.log
      );
      reply.status(201).send(OwnerChargeMutationResponseSchema.parse({ charge }));
    } catch (e) {
      if (e instanceof OwnerChargeInvalide) {
        return reply
          .status(400)
          .send({ success: false, error: "Bad Request", message: e.message });
      }
      request.log.error({ err: e }, "owner charge create failed");
      reply.status(500).send({
        success: false,
        error: "Internal Server Error",
        message: "Erreur lors de l'enregistrement de la charge",
      });
    }
  });

  fastify.patch<{ Params: { id: string } }>(
    "/charges/:id",
    { preHandler: requireOwner },
    async (request, reply) => {
      const parsed = OwnerChargePatchBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "Bad Request",
          message: parsed.error.issues[0]?.message ?? "Charge invalide",
        });
      }
      try {
        const charge = await updateOwnerCharge(
          fastify.pg as Pool,
          request.tenantId!,
          request.params.id,
          parsed.data,
          request.log
        );
        if (!charge) {
          return reply
            .status(404)
            .send({ success: false, error: "Not Found", message: "Charge introuvable" });
        }
        reply.send(OwnerChargeMutationResponseSchema.parse({ charge }));
      } catch (e) {
        if (e instanceof OwnerChargeInvalide) {
          return reply
            .status(400)
            .send({ success: false, error: "Bad Request", message: e.message });
        }
        request.log.error({ err: e }, "owner charge update failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Erreur lors de la mise à jour de la charge",
        });
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    "/charges/:id",
    { preHandler: requireOwner },
    async (request, reply) => {
      try {
        const ok = await deleteOwnerCharge(
          fastify.pg as Pool,
          request.tenantId!,
          request.params.id,
          request.log
        );
        if (!ok) {
          return reply
            .status(404)
            .send({ success: false, error: "Not Found", message: "Charge introuvable" });
        }
        reply.status(204).send();
      } catch (e) {
        request.log.error({ err: e }, "owner charge delete failed");
        reply.status(500).send({
          success: false,
          error: "Internal Server Error",
          message: "Erreur lors de la suppression de la charge",
        });
      }
    }
  );
}
