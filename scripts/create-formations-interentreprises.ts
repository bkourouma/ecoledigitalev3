import { Client } from "pg";

const connectionString = process.env.DATABASE_URL ||
  "postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale";

interface FormationData {
  titre: string;
  description_courte: string;
  objectifs: string[];
  prerequis?: string;
  public_cible?: string;
  duree_jours?: number;
  duree_heures?: number;
  prix_ht?: number;
  prix_ttc: number;
  type_certification?: string;
  nom_certification?: string;
  themes: string[];
  niveau?: "Débutant" | "Intermédiaire" | "Avancé";
  carriere: string;
  dispositifs_pedagogiques?: string;
}

const formations: FormationData[] = [
  {
    titre: "Démarrer avec l'IA et ChatGPT",
    description_courte: "Découvrir en une journée les principes de l'IA et l'utiliser dans son environnement professionnel.",
    objectifs: [
      "Découvrir les principes de l'IA",
      "Utiliser ChatGPT dans son environnement professionnel",
      "Intégrer l'IA dans ses processus métiers"
    ],
    prerequis: "Aucun",
    public_cible: "Professionnels débutants en IA, chefs de projet, marketeurs, consultants, et toute personne souhaitant intégrer l'IA dans ses processus métiers.",
    duree_jours: 1,
    prix_ht: 500,
    prix_ttc: 600,
    themes: ["Intelligence Artificielle", "ChatGPT", "IA Générative"],
    niveau: "Débutant",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement et d'atteinte. Disposer de votre ordinateur, des logiciels et autorisations adéquates."
  },
  {
    titre: "Les fondamentaux de l'IA et du big data",
    description_courte: "Connaître les enjeux et les principes de l'IA et du big data afin de contribuer aux projets AI de l'entreprise.",
    objectifs: [
      "Comprendre les enjeux de l'IA et du big data",
      "Connaître les principes fondamentaux",
      "Contribuer aux projets AI de l'entreprise"
    ],
    prerequis: "Aucun",
    public_cible: "Toute personne souhaitant comprendre les bases de l'IA et du big data. Futurs participants aux projets data, les professionnels de l'informatique.",
    duree_jours: 2,
    prix_ht: 1000,
    prix_ttc: 1200,
    themes: ["Intelligence Artificielle", "Big Data", "Data Science"],
    niveau: "Débutant",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement et d'atteinte. Disposer de votre ordinateur portable. Posséder un compte d'agent conversationnel. Études de cas."
  },
  {
    titre: "Optimiser les écrits professionnels",
    description_courte: "Améliorer la qualité des écrits et supports écrits professionnels avec l'IA.",
    objectifs: [
      "Améliorer la qualité des écrits professionnels",
      "Utiliser l'IA pour optimiser les supports écrits",
      "Maîtriser les outils d'IA pour la rédaction"
    ],
    prerequis: "Aucun",
    public_cible: "Toute personne souhaitant améliorer ses écrits professionnels avec l'IA. Rédacteurs professionnels, responsables communication, secrétaire, marketeurs, chefs de projet.",
    duree_jours: 2,
    prix_ht: 1000,
    prix_ttc: 1200,
    themes: ["Rédaction", "IA Générative", "Communication"],
    niveau: "Débutant",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement et d'atteinte. Disposer de votre ordinateur. Posséder un compte d'agent conversationnel. Études de cas."
  },
  {
    titre: "Aspects juridiques et éthiques de l'IA",
    description_courte: "Comprendre les enjeux juridiques et réglementaires liés à l'IA, notamment la protection des données à caractères personnelles.",
    objectifs: [
      "Comprendre les enjeux juridiques et réglementaires de l'IA",
      "Intégrer la protection des données personnelles",
      "Intégrer les enjeux juridiques dans la conduite des projets"
    ],
    prerequis: "Aucun",
    public_cible: "Juristes, DPO (Délégués à la Protection des Données), chefs de projet, et responsables conformité.",
    duree_jours: 2,
    prix_ht: 1000,
    prix_ttc: 1200,
    themes: ["Droit", "Éthique", "RGPD", "Conformité"],
    niveau: "Intermédiaire",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement et d'atteinte. Disposer de votre ordinateur, des logiciels et autorisations adéquates."
  },
  {
    titre: "Devenez développeur citoyen",
    description_courte: "Développer un projet no code avec les outils IA sans compétences techniques approfondies grâce aux plateformes de développement low-code ou no-code.",
    objectifs: [
      "Développer des projets no-code avec l'IA",
      "Utiliser les plateformes low-code/no-code",
      "Créer des applications sans compétences techniques approfondies"
    ],
    prerequis: "Aucun",
    public_cible: "Tout employé qui sans être informaticien de formation souhaite créer des applications ou des outils spécifiques pour son entreprise ; Entrepreneurs, chefs de produit ; consultants ; professionnels non techniques.",
    duree_jours: 2,
    prix_ht: 1000,
    prix_ttc: 1200,
    themes: ["No-Code", "Low-Code", "Développement", "IA"],
    niveau: "Débutant",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement et d'atteinte. Disposer de votre ordinateur. Boîte à outils remise en fin de formation. Mise en situation sur un projet et sur une plate-forme no-code."
  },
  {
    titre: "Maîtriser le prompt engineering",
    description_courte: "Acquérir les compétences nécessaires pour concevoir, optimiser et exploiter des prompts efficaces dans les systèmes d'intelligence artificielle générative.",
    objectifs: [
      "Concevoir des prompts efficaces",
      "Optimiser l'utilisation des outils d'IA générative",
      "Exploiter au maximum les systèmes d'IA générative"
    ],
    prerequis: "Aucun",
    public_cible: "Tout professionnels de la data science, développeurs, chefs de projet IA, consultants en transformation digitale, et toute personne souhaitant optimiser l'utilisation des outils d'IA générative.",
    duree_jours: 2,
    prix_ht: 1000,
    prix_ttc: 1200,
    themes: ["Prompt Engineering", "IA Générative", "Optimisation"],
    niveau: "Intermédiaire",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement et d'atteinte. Disposer de votre ordinateur. Boîte à outils d'IA générative."
  },
  {
    titre: "L'IA pour l'efficacité et la productivité",
    description_courte: "Acquérir les compétences nécessaires pour être efficace et productif dans les systèmes d'intelligence artificielle générative.",
    objectifs: [
      "Améliorer son efficacité avec l'IA",
      "Augmenter sa productivité grâce aux outils d'IA",
      "Intégrer l'IA dans son workflow quotidien"
    ],
    prerequis: "Aucun",
    public_cible: "Employés, toutes personnes voulant acquérir des compétences en IA générative.",
    duree_jours: 2,
    prix_ht: 1000,
    prix_ttc: 1200,
    themes: ["Productivité", "Efficacité", "IA Générative"],
    niveau: "Débutant",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement et d'atteinte."
  },
  {
    titre: "Maîtriser Microsoft 365 Copilot",
    description_courte: "Faire de la suite Microsoft Office 365 un véritable assistant. Maîtriser les fonctionnalités de Copilot dans les principales applications de la suite Microsoft Office 365.",
    objectifs: [
      "Maîtriser Microsoft 365 Copilot",
      "Utiliser Copilot dans les applications Office 365",
      "Transformer Office 365 en assistant intelligent"
    ],
    prerequis: "Utilisateur de la suite Microsoft 365 Copilot.",
    public_cible: "Rédacteurs professionnels, responsables communication, secrétaire, marketeurs, chefs de projet, et toute personne amenée à produire des contenus écrits dans un cadre professionnel.",
    duree_jours: 2,
    prix_ht: 1000,
    prix_ttc: 1200,
    themes: ["Microsoft 365", "Copilot", "Office 365", "Productivité"],
    niveau: "Intermédiaire",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement et d'atteinte. Mise en situation."
  },
  {
    titre: "L'intelligence artificielle et Big Data pour Manager",
    description_courte: "Utiliser l'IA pour améliorer la prise de décision, la gestion des équipes et l'optimisation des processus.",
    objectifs: [
      "Utiliser l'IA pour améliorer la prise de décision",
      "Optimiser la gestion des équipes avec l'IA",
      "Optimiser les processus avec le Big Data"
    ],
    prerequis: "Aucun",
    public_cible: "Managers traitants de grands volumes de données dans le cadre de son métier ; chef d'entreprise ; directeur et chef de service ; chefs de projet.",
    duree_jours: 2,
    prix_ht: 1000,
    prix_ttc: 1200,
    themes: ["Management", "IA", "Big Data", "Décision"],
    niveau: "Intermédiaire",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Études de cas pratiques. Utilisation d'outils non code. Identifier et concevoir un projet complet d'analyse de données avec l'IA."
  },
  {
    titre: "IA et Big Data pour les DRH",
    description_courte: "Améliorez les pratiques RH avec l'IA et le big data.",
    objectifs: [
      "Améliorer les pratiques RH avec l'IA",
      "Utiliser le Big Data pour les ressources humaines",
      "Optimiser les processus RH"
    ],
    prerequis: "Aucun",
    public_cible: "DRH, RRH, recruteurs, responsables de formation.",
    duree_jours: 2,
    prix_ht: 1000,
    prix_ttc: 1200,
    themes: ["RH", "IA", "Big Data", "Ressources Humaines"],
    niveau: "Intermédiaire",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement et d'atteinte. Disposer de votre ordinateur portable. Posséder un compte d'agent conversationnel. Études de cas."
  },
  {
    titre: "Intégrer l'IA dans l'ingénierie de Formation",
    description_courte: "Améliorez les pratiques formations avec l'IA et le big data.",
    objectifs: [
      "Intégrer l'IA dans l'ingénierie de formation",
      "Améliorer les pratiques de formation",
      "Utiliser le Big Data pour optimiser les formations"
    ],
    prerequis: "Expérience formation",
    public_cible: "Responsable formation (RF), chargé de formation, RRH, formateur",
    duree_jours: 2,
    prix_ht: 1000,
    prix_ttc: 1200,
    themes: ["Formation", "IA", "Big Data", "Ingénierie pédagogique"],
    niveau: "Intermédiaire",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement et d'atteinte. Disposer de votre ordinateur portable. Posséder un compte d'agent conversationnel. Études de cas."
  },
  {
    titre: "IA et Big Data pour Marketing",
    description_courte: "Intégrer l'IA dans les pratiques marketing.",
    objectifs: [
      "Intégrer l'IA dans les pratiques marketing",
      "Utiliser le Big Data pour le marketing",
      "Optimiser les campagnes marketing avec l'IA"
    ],
    prerequis: "Aucun",
    public_cible: "Responsables marketing, chefs de produit, spécialistes du digital.",
    duree_jours: 2,
    prix_ht: 1000,
    prix_ttc: 1200,
    themes: ["Marketing", "IA", "Big Data", "Digital"],
    niveau: "Intermédiaire",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement avant la formation. Questionnaire d'atteinte. Études de cas."
  },
  {
    titre: "L'IA pour la communication",
    description_courte: "Découvrir en une journée les principes de l'IA et l'utiliser dans son environnement professionnel pour la communication.",
    objectifs: [
      "Découvrir les principes de l'IA pour la communication",
      "Utiliser l'IA dans son environnement professionnel",
      "Intégrer l'IA dans les processus de communication"
    ],
    prerequis: "Aucun",
    public_cible: "Professionnels débutants en IA, chefs de projet, marketeurs, consultants, et toute personne souhaitant intégrer l'IA dans ses processus métiers.",
    duree_jours: 1,
    prix_ht: 500,
    prix_ttc: 600,
    themes: ["Communication", "IA", "IA Générative"],
    niveau: "Débutant",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement avant la formation. Questionnaire d'atteinte. Boîte à outils actualisés d'IA génératives."
  },
  {
    titre: "Optimiser son SEO grâce à l'IA",
    description_courte: "Découvrir en une journée les principes de l'IA et l'utiliser dans son environnement professionnel pour optimiser le SEO.",
    objectifs: [
      "Optimiser le SEO avec l'IA",
      "Utiliser l'IA pour améliorer le référencement",
      "Intégrer l'IA dans les stratégies SEO"
    ],
    prerequis: "Aucun",
    public_cible: "Référenceurs, spécialistes du web marketing, chefs de projet digital.",
    duree_jours: 1,
    prix_ht: 500,
    prix_ttc: 600,
    themes: ["SEO", "Référencement", "IA", "Web Marketing"],
    niveau: "Intermédiaire",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement et d'atteinte. Disposer de votre ordinateur portable. Posséder un compte d'agent conversationnel. Études de cas."
  },
  {
    titre: "Intégrer l'IA dans la gestion de projets",
    description_courte: "Expérimenter l'usage de l'IA générative pour la gestion des projets.",
    objectifs: [
      "Expérimenter l'usage de l'IA générative pour la gestion de projets",
      "Intégrer l'IA dans les processus de gestion de projets",
      "Optimiser la gestion de projets avec l'IA"
    ],
    prerequis: "Connaissances de base en informatique",
    public_cible: "Accompagnateur de projet intégrant l'IA.",
    duree_jours: 5,
    prix_ht: 2500,
    prix_ttc: 3000,
    themes: ["Gestion de Projets", "IA", "IA Générative", "Management"],
    niveau: "Avancé",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement et d'atteinte. Disposer de votre ordinateur portable. Posséder un compte d'agent conversationnel. Études de cas."
  },
  {
    titre: "Piloter un projet d'IA",
    description_courte: "Acquérir les compétences nécessaires pour piloter efficacement un projet d'IA de sa conception à sa mise en production.",
    objectifs: [
      "Piloter efficacement un projet d'IA",
      "Gérer un projet d'IA de la conception à la production",
      "Maîtriser les spécificités des projets d'IA"
    ],
    prerequis: "Connaissances de base en informatique",
    public_cible: "Accompagnateur de projet intégrant l'IA, chefs de projet, managers, directeurs de programme et responsables opérationnels impliqués dans des projets d'IA.",
    duree_jours: 4,
    prix_ht: 2000,
    prix_ttc: 2400,
    themes: ["Gestion de Projets", "IA", "Pilotage", "Management"],
    niveau: "Avancé",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement et d'atteinte. Disposer de votre ordinateur portable. Posséder un compte d'agent conversationnel. Études de cas."
  },
  {
    titre: "Chef de projet IA",
    description_courte: "Gérer l'ensemble des aspects techniques, humains et organisationnels des projets d'IA.",
    objectifs: [
      "Gérer les aspects techniques des projets d'IA",
      "Gérer les aspects humains et organisationnels",
      "Maîtriser tous les aspects de la gestion de projets d'IA"
    ],
    prerequis: "Connaissances de base en informatique (téléchargement des fichiers, utilisation de navigateurs internet…)",
    public_cible: "Toute personne devant intégrer l'IA dans un projet, Chef de projet IA",
    duree_jours: 5,
    prix_ht: 2500,
    prix_ttc: 3000,
    themes: ["Gestion de Projets", "IA", "Chef de Projet", "Management"],
    niveau: "Avancé",
    carriere: "LES FORMATIONS INTERENTREPRISES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Questionnaires de positionnement et d'atteinte. Disposer de votre ordinateur portable."
  }
];

function generateSlug(titre: string): string {
  return titre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
}

async function createFormations() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log("🔗 Connected to database");

    await client.query("BEGIN");

    // Get tenant ID for imhotepdata
    const tenantResult = await client.query(
      "SELECT id FROM tenants WHERE slug = 'imhotepdata'"
    );

    if (tenantResult.rows.length === 0) {
      throw new Error("Tenant 'imhotepdata' not found");
    }

    const tenantId = tenantResult.rows[0].id;
    console.log(`📋 Using tenant: imhotepdata (${tenantId})`);
    console.log("");

    let createdCount = 0;
    let skippedCount = 0;

    for (const formation of formations) {
      const slug = generateSlug(formation.titre);

      // Check if formation already exists
      const existingCheck = await client.query(
        "SELECT id FROM formations_professionnelles WHERE tenant_id = $1 AND slug = $2",
        [tenantId, slug]
      );

      if (existingCheck.rows.length > 0) {
        console.log(`⏭️  Skipping: ${formation.titre} (already exists)`);
        skippedCount++;
        continue;
      }

      // Build description_complete from dispositifs_pedagogiques if available
      let description_complete = formation.description_courte;
      if (formation.dispositifs_pedagogiques) {
        description_complete += "\n\nDispositifs pédagogiques particuliers :\n" + formation.dispositifs_pedagogiques;
      }

      const insertQuery = `
        INSERT INTO formations_professionnelles (
          tenant_id,
          titre,
          slug,
          description_courte,
          objectifs,
          prerequis,
          public_cible,
          duree_jours,
          duree_heures,
          prix_ht,
          prix_ttc,
          type_certification,
          nom_certification,
          themes,
          niveau,
          carriere,
          actif,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, true, $17)
        RETURNING id, slug, titre
      `;

      const result = await client.query(insertQuery, [
        tenantId,
        formation.titre,
        slug,
        formation.description_courte,
        JSON.stringify(formation.objectifs),
        formation.prerequis || null,
        formation.public_cible || null,
        formation.duree_jours || null,
        formation.duree_heures || null,
        formation.prix_ht || null,
        formation.prix_ttc,
        formation.type_certification || null,
        formation.nom_certification || null,
        JSON.stringify(formation.themes),
        formation.niveau || null,
        formation.carriere,
        null, // created_by
      ]);

      createdCount++;
      console.log(`✅ Created: ${formation.titre}`);
    }

    await client.query("COMMIT");

    console.log("");
    console.log("📊 Summary:");
    console.log(`   ✅ Created: ${createdCount} formations`);
    console.log(`   ⏭️  Skipped: ${skippedCount} formations (already exist)`);
    console.log("");
    console.log("✅ All formations created successfully!");

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating formations:", error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the script
createFormations()
  .then(() => {
    console.log("🎉 Script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Script failed:", error);
    process.exit(1);
  });

