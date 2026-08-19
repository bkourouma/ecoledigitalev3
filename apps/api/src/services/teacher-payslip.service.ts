/**
 * Assemblage des données d'un bulletin de paie — feature 031.
 *
 * Sépare la COLLECTE (ici) de la MISE EN PAGE
 * (`teacher-payslip-template.service.ts`) : le gabarit doit pouvoir changer de
 * charte sans qu'on touche aux requêtes, et inversement.
 *
 * Aucun calcul : les montants sont lus tels que `payment-calculator.ts` les a
 * écrits. Recalculer ici produirait un PDF qui ne correspondrait pas au montant
 * approuvé, ce qui est exactement ce qu'un bulletin ne doit jamais faire.
 */

import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";
import { renderPayslipPdf, type PayslipData, type PayslipLigne } from "./teacher-payslip-template.service";

/** Détail des heures rattaché au paiement, une ligne par séance ou session. */
const SQL_LIGNES = `
  SELECT phd.source,
         phd.hours_count::float8  AS heures,
         phd.hourly_rate::float8  AS taux,
         phd.amount::float8       AS montant,
         phd.is_overtime          AS heures_sup,
         se.date::text            AS date_seance,
         ec.libelle               AS ecue_libelle,
         us.libelle               AS cohorte_libelle,
         asn.session_date::text   AS date_session,
         c.name                   AS cours_libelle,
         cl.name                  AS classe_libelle
    FROM payment_hour_details phd
    LEFT JOIN professional_ecue_seances se ON se.id = phd.seance_id
    LEFT JOIN professional_ecue        ec ON ec.id = se.ecue_id
    LEFT JOIN professional_ue_sessions us ON us.id = se.ue_session_id
    LEFT JOIN attendance_sessions     asn ON asn.id = phd.attendance_session_id
    -- Le cours academique passe par la table de liaison classe/cours :
    -- attendance_sessions ne porte pas course_id directement.
    LEFT JOIN class_courses            cc ON cc.id = asn.class_course_id
    LEFT JOIN courses                   c ON c.id  = cc.course_id
    LEFT JOIN classes                  cl ON cl.id = cc.class_id
   WHERE phd.payment_id = $1 AND phd.tenant_id = $2
   ORDER BY COALESCE(se.date, asn.session_date), ec.libelle`;

const SQL_PAIEMENT = `
  SELECT tp.id, tp.status::text AS statut, tp.currency AS devise,
         tp.payment_type::text  AS type_paiement,
         tp.base_amount::float8 AS base, tp.overtime_amount::float8 AS heures_sup,
         tp.bonus_amount::float8 AS primes, tp.deductions::float8 AS retenues,
         tp.total_amount::float8 AS total,
         tp.calculation_details AS details,
         pp.name AS periode_nom,
         pp.period_start::text AS periode_debut,
         pp.period_end::text   AS periode_fin,
         COALESCE(TRIM(u.first_name || ' ' || u.last_name),
                  TRIM(t.first_name || ' ' || t.last_name)) AS enseignant_nom,
         COALESCE(u.email, t.email)   AS enseignant_email,
         t.employee_number            AS matricule,
         tn.name                      AS etablissement_nom,
         tn.settings_json             AS etablissement_config,
         cfg.config_type::text        AS config_type,
         cfg.monthly_salary::float8   AS config_salaire_mensuel,
         cfg.annual_salary::float8    AS config_salaire_annuel,
         cfg.default_hourly_rate::float8 AS config_taux_horaire,
         cfg.overtime_threshold::int  AS config_seuil_hs,
         cfg.overtime_multiplier::float8 AS config_multiplicateur_hs
    FROM teacher_payments tp
    JOIN payment_periods pp ON pp.id = tp.payment_period_id
    JOIN teachers        t  ON t.id  = tp.teacher_id
    LEFT JOIN users      u  ON u.id  = t.user_id
    JOIN tenants        tn  ON tn.id = tp.tenant_id
    -- Configuration EN VIGUEUR sur la période : c'est elle qui explique le
    -- montant. Celle d'aujourd'hui pourrait avoir changé depuis, et le bulletin
    -- afficherait alors un taux qui n'a jamais servi à ce calcul.
    LEFT JOIN LATERAL (
      SELECT c.* FROM teacher_payment_configs c
       WHERE c.teacher_id = tp.teacher_id AND c.tenant_id = tp.tenant_id
         AND c.effective_from <= pp.period_end
         AND (c.effective_to IS NULL OR c.effective_to >= pp.period_start)
       ORDER BY c.effective_from DESC
       LIMIT 1
    ) cfg ON TRUE
   WHERE tp.id = $1 AND tp.tenant_id = $2`;

/**
 * Identité de l'établissement, reprise des bulletins de notes
 * (`report-card-template.service.ts`, où elle est écrite en dur).
 *
 * Ces valeurs ne servent que de REPLI : `settings_json` du tenant les remplace
 * dès qu'il les porte. Les dupliquer ici est un pis-aller assumé — la vraie
 * correction serait de les faire descendre du paramétrage pour les deux
 * documents, mais toucher au bulletin de notes déborde du sujet.
 */
const ECOLE_NOM = "IMHOTEP ACADEMY (EXASP CI)";
const ECOLE_CONTACT = "03 BP 587 ABIDJAN 03 - Tel : 075 981 864 / 0707 755 94";

/** Année scolaire d'une période, pivot septembre — convention de l'application. */
function anneeScolaire(debut: string | null): string | null {
  if (!debut) return null;
  const d = new Date(`${debut}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  const a = d.getFullYear();
  return d.getMonth() + 1 >= 9 ? `${a}-${a + 1}` : `${a - 1}-${a}`;
}

export class TeacherPayslipService extends ProfessionalBaseService {
  /** Données complètes du bulletin, prêtes pour la mise en page. */
  async getPayslipData(tenantId: string, paymentId: string): Promise<ServiceResult<PayslipData>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(SQL_PAIEMENT, [paymentId, tenantId]);
      if (res.rowCount === 0) return fail("PAYMENT_NOT_FOUND", "Paiement introuvable.");
      const p = res.rows[0];

      const detail = await client.query(SQL_LIGNES, [paymentId, tenantId]);
      const lignes: PayslipLigne[] = detail.rows.map((l) => ({
        date: l.date_seance ?? l.date_session ?? null,
        origine: l.source === "professionnel" ? "professionnel" : "academique",
        intitule: l.ecue_libelle ?? l.cours_libelle ?? null,
        // Côté professionnel la cohorte est la session d'UE ; côté académique,
        // c'est la classe. Même colonne, deux origines.
        cohorte: l.cohorte_libelle ?? l.classe_libelle ?? null,
        heures: Number(l.heures ?? 0),
        taux: Number(l.taux ?? 0),
        montant: Number(l.montant ?? 0),
        heures_sup: Boolean(l.heures_sup),
      }));

      const details = (p.details ?? {}) as any;
      const config = (p.etablissement_config ?? {}) as any;

      // Le contact d'établissement est facultatif et dépend du paramétrage du
      // tenant : absent, l'en-tête se limite au nom.
      const contact =
        [config?.address, config?.phone, config?.email].filter(Boolean).join(" | ") || null;

      return ok({
        paiementId: p.id,
        statut: p.statut,
        devise: p.devise ?? "XOF",

        enseignantNom: p.enseignant_nom ?? "Enseignant",
        enseignantEmail: p.enseignant_email ?? null,
        enseignantMatricule: p.matricule ?? null,

        periodeNom: p.periode_nom,
        periodeDebut: p.periode_debut,
        periodeFin: p.periode_fin,

        typePaiement:
          p.type_paiement === "hourly"
            ? "Horaire"
            : p.type_paiement === "salary"
              ? "Salaire"
              : p.type_paiement === "mixed"
                ? "Mixte"
                : (p.type_paiement ?? "—"),
        montantBase: Number(p.base ?? 0),
        montantHeuresSup: Number(p.heures_sup ?? 0),
        primes: Number(p.primes ?? 0),
        retenues: Number(p.retenues ?? 0),
        montantTotal: Number(p.total ?? 0),

        heuresNormales: Number(details?.regularHours ?? 0),
        heuresSup: Number(details?.overtimeHours ?? 0),
        tauxNormal: details?.rates?.regular != null ? Number(details.rates.regular) : null,

        lignes,

        // Configuration en vigueur : elle dicte CE QU'IL FAUT MONTRER. Un
        // salarié n'a pas de taux horaire, un vacataire n'a pas de salaire —
        // afficher les deux avec des tirets ferait passer une donnée sans objet
        // pour une donnée manquante.
        config: p.config_type
          ? {
              type: p.config_type as "salary" | "hourly" | "mixed",
              salaireMensuel:
                p.config_salaire_mensuel ??
                (p.config_salaire_annuel != null ? p.config_salaire_annuel / 12 : null),
              salaireAnnuel: p.config_salaire_annuel ?? null,
              tauxHoraire: p.config_taux_horaire ?? null,
              seuilHeuresSup: p.config_seuil_hs ?? null,
              multiplicateurHeuresSup: p.config_multiplicateur_hs ?? null,
            }
          : null,

        joursOuvres: Number(details?.workingDays ?? 0),
        joursPeriode: Number(details?.periodDays ?? 0),

        // Identité de l'école, alignée sur le bulletin de notes qui l'écrit en
        // dur. Le nom du tenant est un identifiant technique (« ecoledigitale »)
        // : l'afficher ferait porter deux noms différents à deux documents du
        // même dossier. Le paramétrage prime dès qu'il existe.
        etablissementNom: config?.schoolName || ECOLE_NOM,
        etablissementContact: contact || ECOLE_CONTACT,
        anneeScolaire: anneeScolaire(p.periode_debut),
        genereLe: new Date().toISOString(),

        // Mentions officielles — mêmes valeurs que les bulletins de notes.
        // Paramétrables par tenant, avec repli sur l'en-tête en vigueur : un
        // document sans tutelle ni devise ne ressemble pas aux autres pièces
        // du dossier de l'enseignant.
        tutelleMinistere:
          config?.ministryName ||
          "MINISTERE DE L'ENSEIGNEMENT SUPERIEUR ET DE LA RECHERCHE SCIENTIFIQUE",
        tutelleDirection: config?.directionName || "DIRECTION DEPARTEMENTALE D'ABIDJAN 1",
        republique: config?.countryName || "REPUBLIQUE DE COTE D'IVOIRE",
        devise_republique: config?.countryMotto || "Union - Discipline - Travail",
        villeSignature: config?.city || "ABIDJAN",
      });
    });
  }

  /** Bulletin au format PDF. */
  async generatePdf(tenantId: string, paymentId: string): Promise<ServiceResult<Buffer>> {
    const data = await this.getPayslipData(tenantId, paymentId);
    if (!data.success) return data as ServiceResult<Buffer>;
    const pdf = await renderPayslipPdf(data.data);
    return ok(pdf);
  }
}
